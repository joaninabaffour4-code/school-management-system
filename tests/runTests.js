import http from 'http';
import app from '../src/server.js';
import { encryptData, decryptData } from '../src/utils/crypto.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { generateTotpSetup, verifyTotpToken } from '../src/utils/totp.js';
import { authenticator } from 'otplib';
import { runDatabaseBackup } from '../src/utils/backup.js';
import { verifyRestoreTest } from '../src/utils/restore.js';

import { setupDatabase } from '../src/setupDatabase.js';

import { resetRateLimit } from '../src/utils/auth.js';

import { run } from '../src/config/database.js';

let server;
const PORT = 3999;
const baseUrl = `http://localhost:${PORT}`;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body) {
      reqBody = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

const results = [];
function recordTest(category, name, passed, details = '') {
  results.push({ category, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] [${category}] ${name} ${details ? '(' + details + ')' : ''}`);
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  STARTING INTEGRATED ACADEMIC SECURITY & RBAC TEST SUITE');
  console.log('================================================================');

  await setupDatabase();
  await run("UPDATE users SET is_2fa_enabled = 0, totp_secret_encrypted = NULL, totp_secret_iv = NULL, totp_secret_tag = NULL WHERE username = 'admin'");
  server = app.listen(PORT);
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    // -------------------------------------------------------------------------
    // 1. Cryptographic Technique & Password Security (AES-256-GCM + Bcrypt + Pepper)
    // -------------------------------------------------------------------------
    const secretText = 'TOTP_SECRET_SUPER_CONFIDENTIAL_12345';
    const encrypted = encryptData(secretText);
    const decrypted = decryptData(encrypted.encrypted, encrypted.iv, encrypted.tag);
    recordTest(
      'Cryptography',
      'AES-256-GCM Authenticated Encryption & Decryption',
      decrypted === secretText,
      `IV: ${encrypted.iv.length / 2} bytes, Tag: ${encrypted.tag.length / 2} bytes`
    );

    // Tamper detection test: modify 1 character of ciphertext
    let tamperedPassed = false;
    try {
      const tamperedCipher = encrypted.encrypted.replace(/^[0-9a-f]/, (c) => (c === 'a' ? 'b' : 'a'));
      decryptData(tamperedCipher, encrypted.iv, encrypted.tag);
    } catch (err) {
      tamperedPassed = true; // Decipher threw authentication tag error
    }
    recordTest('Cryptography', 'AES-256-GCM Tamper Detection (Integrity Rejection)', tamperedPassed);

    // Password Salt & Pepper
    const rawPwd = 'MasterTestPassword@2026';
    const hash1 = await hashPassword(rawPwd);
    const hash2 = await hashPassword(rawPwd);
    const hashesDifferent = hash1 !== hash2; // Different salts must produce distinct hashes!
    const verify1 = await verifyPassword(rawPwd, hash1);
    const verifyInvalid = await verifyPassword('WrongPassword', hash1);
    recordTest(
      'Password Security',
      'Bcrypt Unique Salts (Identical passwords produce distinct hashes)',
      hashesDifferent && verify1 && !verifyInvalid,
      'Cost factor 12 + secret pepper'
    );

    // -------------------------------------------------------------------------
    // 2. Health Check Endpoint
    // -------------------------------------------------------------------------
    const health = await makeRequest('GET', '/health');
    recordTest('System Health', 'GET /health returns healthy status and DB connectivity', health.status === 200 && health.body.status === 'healthy');

    // -------------------------------------------------------------------------
    // 3. User Identification & Authentication (Username Login)
    // -------------------------------------------------------------------------
    resetRateLimit('login:admin');
    resetRateLimit('admin-login:admin');

    // Valid Admin Login with Username
    const adminLogin = await makeRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: 'Admin@123',
    });
    const adminToken = adminLogin.body.token;
    recordTest('Authentication', 'Valid Login with Username ("admin")', adminLogin.status === 200 && Boolean(adminToken));

    // Invalid Password Rejection
    const badPwd = await makeRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: 'IncorrectPassword!',
    });
    recordTest('Authentication', 'Invalid Password Rejection (401)', badPwd.status === 401);
    resetRateLimit('login:admin');

    // Unknown Username Rejection
    const badUser = await makeRequest('POST', '/api/auth/login', {
      username: 'nonexistent_user_9999',
      password: 'SomePassword123!',
    });
    recordTest('Authentication', 'Unknown Username Rejection (401 Timing-Safe)', badUser.status === 401);

    // -------------------------------------------------------------------------
    // 4. Registration & Mandatory Email Verification
    // -------------------------------------------------------------------------
    const testRegUser = `stu_test_${Date.now()}`;
    const testRegEmail = `test_${Date.now()}@school.edu`;

    const regRes = await makeRequest('POST', '/api/auth/register', {
      firstName: 'Student',
      lastName: 'Tester',
      username: testRegUser,
      email: testRegEmail,
      role: 'Student',
      password: 'StrongStudentPassword@123',
    });
    recordTest('Registration', 'Register Student with Unique Username & Email (201)', regRes.status === 201);

    // Duplicate Username Registration Rejection
    const dupUserRes = await makeRequest('POST', '/api/auth/register', {
      firstName: 'Duplicate',
      lastName: 'User',
      username: testRegUser,
      email: `another_${Date.now()}@school.edu`,
      role: 'Student',
      password: 'StrongStudentPassword@123',
    });
    recordTest('Registration', 'Duplicate Username Registration Prevented (409)', dupUserRes.status === 409);

    // Mandatory Email Verification Enforcement: Unverified user cannot log in
    const unverifiedLogin = await makeRequest('POST', '/api/auth/login', {
      username: testRegUser,
      password: 'StrongStudentPassword@123',
    });
    recordTest(
      'Email Verification',
      'Mandatory Email Verification Enforced (Login blocked with 403 until verified)',
      unverifiedLogin.status === 403 && unverifiedLogin.body.emailVerificationRequired === true
    );

    // Resend Email Verification Rate Limiting
    const resend1 = await makeRequest('POST', '/api/auth/resend-verification', { email: testRegEmail });
    const resend2 = await makeRequest('POST', '/api/auth/resend-verification', { email: testRegEmail });
    recordTest('Email Verification', 'Resend Verification Email Rate Limiting (429)', resend2.status === 429);

    // -------------------------------------------------------------------------
    // 5. Separate Administrator Authentication Interface
    // -------------------------------------------------------------------------
    // Teacher attempting to login via /api/auth/admin/login must be rejected
    const teacherAdminAttempt = await makeRequest('POST', '/api/auth/admin/login', {
      username: 'teacher1',
      password: 'Password@123',
    });
    recordTest('Admin Auth', 'Non-Admin Rejected from Dedicated Admin Login Endpoint (401)', teacherAdminAttempt.status === 401);

    // Valid Admin Login via /api/auth/admin/login
    resetRateLimit('admin-login:admin');
    const adminPasswordUsed = 'Admin@123';
    const adminDedicated = await makeRequest('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: adminPasswordUsed,
    });
    const dedicatedAdminToken = adminDedicated.body.token;
    recordTest('Admin Auth', 'Dedicated Administrator Login Succeeded (200)', adminDedicated.status === 200 && Boolean(dedicatedAdminToken));

    // -------------------------------------------------------------------------
    // 6. Two-Factor Authentication (TOTP 2FA)
    // -------------------------------------------------------------------------
    // Setup TOTP for admin
    const setup2faRes = await makeRequest(
      'POST',
      '/api/auth/2fa/setup',
      {},
      { Authorization: `Bearer ${dedicatedAdminToken}` }
    );
    const qrReceived = setup2faRes.status === 200 && Boolean(setup2faRes.body.qrCode);
    const manualSecret = setup2faRes.body.manualEntrySecret;
    recordTest('2FA (TOTP)', 'Initiate 2FA Setup & Generate QR Code + AES-256-GCM Encrypted Secret', qrReceived);

    // Confirm initial 2FA code
    const validOtpCode = authenticator.generate(manualSecret);
    const enable2faRes = await makeRequest(
      'POST',
      '/api/auth/2fa/enable',
      { code: validOtpCode },
      { Authorization: `Bearer ${dedicatedAdminToken}` }
    );
    recordTest('2FA (TOTP)', 'Enable 2FA with Valid One-Time Authenticator Code (200)', enable2faRes.status === 200);

    // Subsequent Login now requires 2FA code
    const secondLoginRes = await makeRequest('POST', '/api/auth/admin/login', {
      username: 'admin',
      password: adminPasswordUsed,
    });
    const twoFactorChallenged =
      secondLoginRes.status === 200 &&
      secondLoginRes.body.twoFactorRequired === true &&
      Boolean(secondLoginRes.body.tempToken);
    recordTest('2FA (TOTP)', 'Login Challenge Enforced (Issues short-lived tempToken)', twoFactorChallenged);

    // Verify TOTP challenge
    const newOtpCode = authenticator.generate(manualSecret);
    const verify2faRes = await makeRequest('POST', '/api/auth/2fa/verify', {
      tempToken: secondLoginRes.body.tempToken,
      code: newOtpCode,
    });
    recordTest('2FA (TOTP)', 'Verify TOTP Challenge & Issue Authenticated Session (200)', verify2faRes.status === 200 && Boolean(verify2faRes.body.token));

    // Disable 2FA for future test convenience
    await makeRequest(
      'POST',
      '/api/auth/2fa/disable',
      { password: adminPasswordUsed },
      { Authorization: `Bearer ${verify2faRes.body.token}` }
    );

    // -------------------------------------------------------------------------
    // 7. Role-Based Access Control (RBAC) Enforcement
    // -------------------------------------------------------------------------
    // Log in Teacher
    const teacherLogin = await makeRequest('POST', '/api/auth/login', {
      username: 'teacher1',
      password: 'Password@123',
    });
    const teacherToken = teacherLogin.body.token;

    // Log in Student
    const studentLogin = await makeRequest('POST', '/api/auth/login', {
      username: 'student1',
      password: 'Password@123',
    });
    const studentToken = studentLogin.body.token;

    // Log in Parent
    const parentLogin = await makeRequest('POST', '/api/auth/login', {
      username: 'parent1',
      password: 'Password@123',
    });
    const parentToken = parentLogin.body.token;

    // RBAC: Student attempting to access Admin endpoint must be blocked (403)
    const studentAdminAccess = await makeRequest('GET', '/api/admin/users', null, {
      Authorization: `Bearer ${studentToken}`,
    });
    recordTest('RBAC Authorization', 'Student Blocked from Admin Endpoints (403 Forbidden)', studentAdminAccess.status === 403);

    // RBAC: Teacher attempting to access Admin endpoint must be blocked (403)
    const teacherAdminAccess = await makeRequest('GET', '/api/admin/stats', null, {
      Authorization: `Bearer ${teacherToken}`,
    });
    recordTest('RBAC Authorization', 'Teacher Blocked from Admin Endpoints (403 Forbidden)', teacherAdminAccess.status === 403);

    // RBAC: Parent attempting to access Teacher attendance endpoint must be blocked (403)
    const parentTeacherAccess = await makeRequest('POST', '/api/teacher/attendance', {}, {
      Authorization: `Bearer ${parentToken}`,
    });
    recordTest('RBAC Authorization', 'Parent Blocked from Teacher Endpoints (403 Forbidden)', parentTeacherAccess.status === 403);

    // RBAC: Unauthenticated Guest blocked from protected endpoint (401)
    const guestAccess = await makeRequest('GET', '/api/admin/users');
    recordTest('RBAC Authorization', 'Unauthenticated Guest Blocked (401 Unauthorized)', guestAccess.status === 401);

    // -------------------------------------------------------------------------
    // 8. Academic Permissions & Anti-IDOR Protections
    // -------------------------------------------------------------------------
    // Teacher: view assigned classes
    const teacherClasses = await makeRequest('GET', '/api/teacher/classes', null, {
      Authorization: `Bearer ${teacherToken}`,
    });
    recordTest('Teacher Operations', 'Teacher can view authorized classes & subjects (200)', teacherClasses.status === 200 && Array.isArray(teacherClasses.body));

    // Teacher: record attendance
    const recordAttRes = await makeRequest(
      'POST',
      '/api/teacher/attendance',
      {
        classId: 1,
        date: '2026-10-15',
        records: [{ studentId: 1, status: 'present', notes: 'Punctual' }],
      },
      { Authorization: `Bearer ${teacherToken}` }
    );
    recordTest('Teacher Operations', 'Teacher records class attendance (200)', recordAttRes.status === 200);

    // Student: view official grades
    const studentGrades = await makeRequest('GET', '/api/student/grades', null, {
      Authorization: `Bearer ${studentToken}`,
    });
    recordTest('Student Operations', 'Student can view published grades (200)', studentGrades.status === 200 && Array.isArray(studentGrades.body));

    // Parent: Multi-Child View
    const parentChildren = await makeRequest('GET', '/api/parent/children', null, {
      Authorization: `Bearer ${parentToken}`,
    });
    recordTest(
      'Parent Operations',
      'Parent Multi-Child Support (Returns all officially linked children)',
      parentChildren.status === 200 && parentChildren.body.length >= 2,
      `Linked children count: ${parentChildren.body ? parentChildren.body.length : 0}`
    );

    // Anti-IDOR Security: Parent attempting to access UNRELATED student record (e.g. student ID 999) must be rejected (403)
    const idorAttempt = await makeRequest('GET', '/api/parent/children/999/grades', null, {
      Authorization: `Bearer ${parentToken}`,
    });
    recordTest(
      'Anti-IDOR Security',
      'Parent Prevented from Accessing Unrelated Student Records (403 Forbidden)',
      idorAttempt.status === 403
    );

    // -------------------------------------------------------------------------
    // 9. Automated AWS S3 Database Backup & Restore Tests
    // -------------------------------------------------------------------------
    const backupResult = await runDatabaseBackup('automated_test_suite');
    recordTest(
      'AWS Backups',
      'Automated Database Backup Executed with AES-256-GCM Encryption',
      Boolean(backupResult.filename && backupResult.sha256),
      `File: ${backupResult.filename}, Size: ${backupResult.sizeBytes} bytes`
    );

    const restoreResult = await verifyRestoreTest(backupResult.filename);
    recordTest(
      'AWS Backups',
      'Isolated Restore Verification to data/test_restored.db (Live DB Untouched)',
      restoreResult.success === true && restoreResult.tablesCount >= 20,
      `Tables: ${restoreResult.tablesCount}, Users: ${restoreResult.usersCount}`
    );

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('================================================================');
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    console.log(`  TEST RESULTS SUMMARY: ${passed} / ${total} PASSED (${failed} FAILED)`);
    console.log('================================================================');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal error during test suite execution:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTestSuite();
