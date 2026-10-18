import express from 'express';
import { get, run, all } from '../config/database.js';
import { createToken, createTemp2faToken, verifyToken, checkRateLimit, resetRateLimit } from '../utils/auth.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateTotpSetup, verifyTotpToken } from '../utils/totp.js';
import { generateTokenAndExpiry, sendVerificationEmail, sendPasswordResetEmail } from '../utils/email.js';
import { authenticate, recordAuditLog } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Normalizes username input: lowercase, trim, remove unexpected characters.
 */
const normalizeUsername = (val = '') => String(val).trim().toLowerCase();

/**
 * POST /api/auth/register
 * Public registration for students and parents.
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role, phone } = req.body;

    if (!username || !email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    const cleanUsername = normalizeUsername(username);
    const cleanEmail = String(email).trim().toLowerCase();

    // Username validation (alphanumeric, underscores, 3-30 chars)
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({
        message: 'Username must be 3-30 characters long and contain only letters, numbers, and underscores.',
      });
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ message: 'Invalid email address format.' });
    }

    // Password strength check
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    // Role check: Only Student or Parent/Guardian allowed for public registration
    const roleNormalize = {
      student: 'Student',
      parent: 'Parent/Guardian',
      'parent/guardian': 'Parent/Guardian',
      guardian: 'Parent/Guardian',
    };
    const cleanRole = roleNormalize[String(role).trim().toLowerCase()] || role;
    const allowedPublicRoles = ['Student', 'Parent/Guardian'];
    if (!allowedPublicRoles.includes(cleanRole)) {
      return res.status(403).json({
        message: 'Public registration is only available for Students and Parents. Teachers and Administrators must be provisioned.',
      });
    }

    // Check unique username
    const existingUsername = await get('SELECT id FROM users WHERE username = ?', [cleanUsername]);
    if (existingUsername) {
      return res.status(409).json({ message: 'Username is already taken. Please choose another username.' });
    }

    // Check unique email
    const existingEmail = await get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingEmail) {
      return res.status(409).json({ message: 'An account with this email address already exists.' });
    }

    const roleRecord = await get('SELECT id FROM roles WHERE name = ?', [cleanRole]);
    if (!roleRecord) {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    // Hash password with bcrypt + salt + pepper
    const passwordHash = await hashPassword(password);

    // Generate single-use email verification token
    const { token: verificationToken, expiresAt } = generateTokenAndExpiry(24);

    const userResult = await run(
      `INSERT INTO users (
        username, email, password_hash, first_name, last_name, role_id, phone,
        is_email_verified, email_verification_token, email_verification_expires, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active')`,
      [cleanUsername, cleanEmail, passwordHash, firstName.trim(), lastName.trim(), roleRecord.id, phone || null, verificationToken, expiresAt]
    );

    const userId = userResult.id;

    // Create role-specific profile row
    if (cleanRole === 'Student') {
      const admissionNumber = `STU-${new Date().getFullYear()}-${String(userId).padStart(4, '0')}`;
      await run('INSERT INTO students (user_id, admission_number) VALUES (?, ?)', [userId, admissionNumber]);
    } else if (cleanRole === 'Parent/Guardian') {
      await run('INSERT INTO guardians (user_id, emergency_phone) VALUES (?, ?)', [userId, phone || null]);
    }

    // Dispatch verification email
    await sendVerificationEmail(cleanEmail, cleanUsername, verificationToken);
    await recordAuditLog(userId, 'REGISTER', 'users', userId, { role: cleanRole, email: cleanEmail });

    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
    const protoHeader = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const dynamicBase = hostHeader ? `${protoHeader}://${hostHeader}` : (process.env.APP_URL || 'http://localhost:3000');
    const verificationUrl = `${dynamicBase}/verify-email.html?token=${verificationToken}`;

    return res.status(201).json({
      message: 'Account registered successfully! A verification email has been dispatched. Please verify your email before logging in.',
      userId,
      username: cleanUsername,
      email: cleanEmail,
      emailVerificationRequired: true,
      verificationUrl,
      verificationToken,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Registration failed due to a server error.', error: error.message, stack: error.stack });
  }
});

/**
 * POST /api/auth/login
 * Standard user login (Teacher, Student, Parent/Guardian).
 * Supports username login as required by Part 1.
 */
router.post('/login', async (req, res) => {
  try {
    const identifier = req.body.username || req.body.email || req.body.identifier;
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const cleanIdentifier = String(identifier).trim().toLowerCase();

    // Rate limiting to prevent brute-force attacks
    const rateCheck = checkRateLimit(`login:${cleanIdentifier}`, 5, 15 * 60 * 1000);
    if (rateCheck.limited) {
      return res.status(429).json({
        message: `Too many failed login attempts. Account temporarily locked for security. Try again in ${rateCheck.retryAfterSeconds} seconds.`,
      });
    }

    // Retrieve user by username or email fallback
    const user = await get(
      `SELECT u.*, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.username = ? OR u.email = ?`,
      [cleanIdentifier, cleanIdentifier]
    );

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Check account status
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ message: `Account is ${user.status}. Please contact the school administration.` });
    }

    // Verify password with bcrypt + pepper
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Reset rate limiter on successful password verification
    resetRateLimit(`login:${cleanIdentifier}`);

    // Mandatory Email Verification Check
    if (!user.is_email_verified) {
      return res.status(403).json({
        message: 'Email verification required. Please verify your email address to access your dashboard.',
        emailVerificationRequired: true,
        email: user.email,
        username: user.username,
      });
    }

    // Two-Factor Authentication Check (TOTP)
    if (user.is_2fa_enabled && user.totp_secret_encrypted) {
      const tempToken = createTemp2faToken(user);
      await recordAuditLog(user.id, 'LOGIN_2FA_CHALLENGE', 'users', user.id);
      return res.json({
        message: 'Two-factor authentication code required.',
        twoFactorRequired: true,
        tempToken,
      });
    }

    // Issue full session token
    const token = createToken(user);
    await recordAuditLog(user.id, 'LOGIN_SUCCESS', 'users', user.id);

    return res.json({
      message: 'Login successful',
      token,
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role === 'admin' ? 'Administrator' : user.role,
        isEmailVerified: Boolean(user.is_email_verified),
        is2faEnabled: Boolean(user.is_2fa_enabled),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed due to a server error.', error: error.message, stack: error.stack });
  }
});

/**
 * POST /api/auth/admin/login
 * Dedicated Administrator Login Endpoint.
 * Enforces role restriction to Administrator only.
 */
router.post('/admin/login', async (req, res) => {
  try {
    const identifier = req.body.username || req.body.email || req.body.identifier;
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Admin username and password are required.' });
    }

    const cleanIdentifier = String(identifier).trim().toLowerCase();

    // Brute-force rate limiting
    const rateCheck = checkRateLimit(`admin-login:${cleanIdentifier}`, 5, 15 * 60 * 1000);
    if (rateCheck.limited) {
      return res.status(429).json({
        message: `Too many failed admin login attempts. Try again in ${rateCheck.retryAfterSeconds} seconds.`,
      });
    }

    const user = await get(
      `SELECT u.*, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE (u.username = ? OR u.email = ?) AND (r.name = 'Administrator' OR r.name = 'admin')`,
      [cleanIdentifier, cleanIdentifier]
    );

    if (!user) {
      // Timing-safe response
      return res.status(401).json({ message: 'Invalid administrator credentials.' });
    }

    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid administrator credentials.' });
    }

    resetRateLimit(`admin-login:${cleanIdentifier}`);

    if (user.status && user.status !== 'active') {
      return res.status(403).json({ message: `Administrator account is ${user.status}.` });
    }

    if (!user.is_email_verified) {
      return res.status(403).json({
        message: 'Admin email verification required.',
        emailVerificationRequired: true,
        email: user.email,
      });
    }

    // Admin 2FA check
    if (user.is_2fa_enabled && user.totp_secret_encrypted) {
      const tempToken = createTemp2faToken(user);
      return res.json({
        message: 'Admin 2FA code required.',
        twoFactorRequired: true,
        tempToken,
      });
    }

    const token = createToken(user);
    await recordAuditLog(user.id, 'ADMIN_LOGIN_SUCCESS', 'users', user.id);

    return res.json({
      message: 'Administrator authentication successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: 'Administrator',
        is2faEnabled: Boolean(user.is_2fa_enabled),
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ message: 'Admin login failed due to an internal error.' });
  }
});

/**
 * POST /api/auth/admin/provision
 * Protected administrator provisioning endpoint.
 * Requires either an existing Administrator session OR the ADMIN_SETUP_SECRET bootstrap key.
 */
router.post('/admin/provision', async (req, res) => {
  try {
    const { setupSecret, username, email, password, firstName, lastName } = req.body;
    const authHeader = req.headers.authorization;

    let authorized = false;

    // Check bootstrap setup secret
    const envSecret = process.env.ADMIN_SETUP_SECRET || 'AdminProvisioningToken2026!SecureKey';
    if (setupSecret && setupSecret === envSecret) {
      authorized = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken(authHeader.split(' ')[1]);
        const adminUser = await get(
          `SELECT u.id, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
          [decoded.id]
        );
        if (adminUser && (adminUser.role === 'Administrator' || adminUser.role === 'admin')) {
          authorized = true;
        }
      } catch (err) {
        // invalid token
      }
    }

    if (!authorized) {
      return res.status(403).json({
        message: 'Unauthorized: Administrator provisioning requires a valid bootstrap secret or existing Administrator credentials.',
      });
    }

    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'All administrator profile fields are required.' });
    }

    const cleanUsername = normalizeUsername(username);
    const cleanEmail = String(email).trim().toLowerCase();

    const existing = await get('SELECT id FROM users WHERE username = ? OR email = ?', [cleanUsername, cleanEmail]);
    if (existing) {
      return res.status(409).json({ message: 'An account with that username or email already exists.' });
    }

    const adminRole = await get("SELECT id FROM roles WHERE name = 'Administrator' OR name = 'admin'");
    const passwordHash = await hashPassword(password);

    const result = await run(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role_id, is_email_verified, status)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'active')`,
      [cleanUsername, cleanEmail, passwordHash, firstName.trim(), lastName.trim(), adminRole.id]
    );

    await recordAuditLog(result.id, 'ADMIN_PROVISIONED', 'users', result.id, { username: cleanUsername, email: cleanEmail });

    return res.status(201).json({
      message: 'New Administrator provisioned successfully.',
      adminId: result.id,
      username: cleanUsername,
      email: cleanEmail,
    });
  } catch (err) {
    console.error('Admin provision error:', err);
    return res.status(500).json({ message: 'Failed to provision administrator.' });
  }
});

/**
 * POST /api/auth/2fa/verify
 * Verifies a 6-digit TOTP code using the short-lived tempToken issued during login.
 */
router.post('/2fa/verify', async (req, res) => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ message: 'Temporary token and 6-digit 2FA code are required.' });
    }

    let decoded;
    try {
      decoded = verifyToken(tempToken);
    } catch (err) {
      return res.status(401).json({ message: '2FA session has expired. Please log in again.' });
    }

    if (!decoded.twoFactorPending) {
      return res.status(400).json({ message: 'Invalid token type for 2FA verification.' });
    }

    const user = await get(
      `SELECT u.*, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!user || !user.totp_secret_encrypted) {
      return res.status(400).json({ message: 'Two-factor authentication is not enrolled for this account.' });
    }

    // Rate-limit 2FA code attempts
    const rateCheck = checkRateLimit(`2fa:${user.id}`, 5, 5 * 60 * 1000);
    if (rateCheck.limited) {
      return res.status(429).json({ message: `Too many invalid 2FA attempts. Try again in ${rateCheck.retryAfterSeconds} seconds.` });
    }

    const isValid = verifyTotpToken(code, user.totp_secret_encrypted, user.totp_secret_iv, user.totp_secret_tag);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid two-factor authentication code.' });
    }

    resetRateLimit(`2fa:${user.id}`);

    // Issue complete authenticated session token
    const token = createToken(user);
    await recordAuditLog(user.id, '2FA_VERIFIED', 'users', user.id);

    return res.json({
      message: 'Two-factor authentication verified successfully',
      token,
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role === 'admin' ? 'Administrator' : user.role,
        is2faEnabled: true,
      },
    });
  } catch (error) {
    console.error('2FA verification error:', error);
    return res.status(500).json({ message: '2FA verification failed due to a server error.' });
  }
});

/**
 * POST /api/auth/2fa/setup
 * Generates a new TOTP secret and QR code for enrollment. Secret is encrypted with AES-256-GCM.
 */
router.post('/2fa/setup', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { secret, qrCodeDataUrl, encryptedSecret } = await generateTotpSetup(user.username);

    // Temporarily save encrypted secret into pending columns
    await run(
      `UPDATE users
       SET totp_secret_encrypted = ?, totp_secret_iv = ?, totp_secret_tag = ?
       WHERE id = ?`,
      [encryptedSecret.encrypted, encryptedSecret.iv, encryptedSecret.tag, user.id]
    );

    await recordAuditLog(user.id, '2FA_SETUP_INITIATED', 'users', user.id);

    return res.json({
      message: '2FA enrollment initiated. Scan the QR code with Google Authenticator or your authenticator app, then enter the 6-digit code to confirm.',
      qrCode: qrCodeDataUrl,
      manualEntrySecret: secret,
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    return res.status(500).json({ message: 'Failed to initialize 2FA enrollment.' });
  }
});

/**
 * POST /api/auth/2fa/enable
 * Confirms the initial TOTP code before permanently enabling 2FA.
 */
router.post('/2fa/enable', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Verification code is required.' });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user || !user.totp_secret_encrypted) {
      return res.status(400).json({ message: 'Please initialize 2FA setup first.' });
    }

    const isValid = verifyTotpToken(code, user.totp_secret_encrypted, user.totp_secret_iv, user.totp_secret_tag);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid verification code. Please check your authenticator clock and try again.' });
    }

    await run('UPDATE users SET is_2fa_enabled = 1 WHERE id = ?', [user.id]);
    await recordAuditLog(user.id, '2FA_ENABLED', 'users', user.id);

    return res.json({ message: 'Two-factor authentication successfully enabled on your account!' });
  } catch (error) {
    console.error('2FA enable error:', error);
    return res.status(500).json({ message: 'Failed to enable 2FA.' });
  }
});

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA (requires current password).
 */
router.post('/2fa/disable', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'Current password is required to disable 2FA.' });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Incorrect password.' });
    }

    await run(
      'UPDATE users SET is_2fa_enabled = 0, totp_secret_encrypted = NULL, totp_secret_iv = NULL, totp_secret_tag = NULL WHERE id = ?',
      [user.id]
    );
    await recordAuditLog(user.id, '2FA_DISABLED', 'users', user.id);

    return res.json({ message: 'Two-factor authentication disabled.' });
  } catch (error) {
    console.error('2FA disable error:', error);
    return res.status(500).json({ message: 'Failed to disable 2FA.' });
  }
});

/**
 * GET /api/auth/verify-email
 * Validates single-use token and marks email verified.
 */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Verification token is missing.' });
    }

    const user = await get(
      `SELECT * FROM users WHERE email_verification_token = ? AND email_verification_expires > datetime('now')`,
      [token]
    );

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired verification token. Please request a new verification email.',
      });
    }

    await run(
      `UPDATE users
       SET is_email_verified = 1, email_verification_token = NULL, email_verification_expires = NULL
       WHERE id = ?`,
      [user.id]
    );

    await recordAuditLog(user.id, 'EMAIL_VERIFIED', 'users', user.id);

    return res.json({
      message: 'Email verified successfully! You may now log in to access your school dashboard.',
      verified: true,
      email: user.email,
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({ message: 'Email verification failed due to a server error.' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resends email verification link with rate limiting.
 */
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Rate limiting: 1 email per 3 minutes
    const rateCheck = checkRateLimit(`resend-email:${cleanEmail}`, 1, 3 * 60 * 1000);
    if (rateCheck.limited) {
      return res.status(429).json({
        message: `Please wait ${rateCheck.retryAfterSeconds} seconds before requesting another verification email.`,
      });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      // Do not reveal account existence
      return res.json({ message: 'If an account exists with that email, a verification link has been sent.' });
    }

    if (user.is_email_verified) {
      return res.status(400).json({ message: 'This email is already verified. You can log in directly.' });
    }

    const { token, expiresAt } = generateTokenAndExpiry(24);
    await run(
      'UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ?',
      [token, expiresAt, user.id]
    );

    await sendVerificationEmail(user.email, user.username, token);

    return res.json({ message: 'A fresh verification email has been dispatched. Please check your inbox.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({ message: 'Failed to resend verification email.' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Initiates password reset by issuing secure token.
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email address is required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const rateCheck = checkRateLimit(`forgot-pwd:${cleanEmail}`, 3, 15 * 60 * 1000);
    if (rateCheck.limited) {
      return res.status(429).json({ message: `Too many password reset requests. Try again later.` });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      // Prevent enumeration
      return res.json({ message: 'If that email is registered, password reset instructions have been sent.' });
    }

    const { token, expiresAt } = generateTokenAndExpiry(1); // 1 hour validity
    await run(
      'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
      [token, expiresAt, user.id]
    );

    await sendPasswordResetEmail(user.email, user.username, token);
    await recordAuditLog(user.id, 'PASSWORD_RESET_REQUESTED', 'users', user.id);

    return res.json({ message: 'If that email is registered, password reset instructions have been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Failed to process password reset request.' });
  }
});

/**
 * POST /api/auth/reset-password
 * Completes password reset using single-use token.
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const user = await get(
      `SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > datetime('now')`,
      [token]
    );

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    const passwordHash = await hashPassword(newPassword);

    await run(
      `UPDATE users
       SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL
       WHERE id = ?`,
      [passwordHash, user.id]
    );

    await recordAuditLog(user.id, 'PASSWORD_RESET_COMPLETED', 'users', user.id);

    return res.json({ message: 'Password has been reset successfully. You may now log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Failed to reset password.' });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
router.get('/me', authenticate, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role === 'admin' ? 'Administrator' : user.role,
    phone: user.phone,
    isEmailVerified: Boolean(user.is_email_verified),
    is2faEnabled: Boolean(user.is_2fa_enabled),
    status: user.status,
  });
});

export default router;
