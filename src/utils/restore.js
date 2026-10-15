import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localBackupDir = path.join(__dirname, '..', '..', 'data', 'backups');
const testRestoredDbPath = path.join(__dirname, '..', '..', 'data', 'test_restored.db');

/**
 * Safely restores the latest backup to an isolated test database (data/test_restored.db)
 * to verify recovery without impacting live production data.
 */
export async function verifyRestoreTest(targetBackupFile = null) {
  console.log('----------------------------------------------------');
  console.log('[RESTORE TEST] Beginning Isolated Recovery Validation');
  console.log('----------------------------------------------------');

  let fileToRestore = targetBackupFile;
  if (!fileToRestore) {
    if (!fs.existsSync(localBackupDir)) {
      throw new Error(`Backup directory ${localBackupDir} does not exist.`);
    }
    const files = fs.readdirSync(localBackupDir).filter((f) => f.endsWith('.db.enc'));
    if (files.length === 0) {
      throw new Error('No encrypted backup files found in backup directory.');
    }
    // Sort descending by timestamp in filename
    files.sort().reverse();
    fileToRestore = files[0];
  }

  const encryptedFilePath = path.join(localBackupDir, fileToRestore);
  console.log(`[RESTORE TEST] Selected backup artifact: ${fileToRestore}`);

  const encryptedBuffer = fs.readFileSync(encryptedFilePath);
  if (encryptedBuffer.length < 28) {
    throw new Error('Invalid backup file: header too short for IV and authentication tag.');
  }

  // Extract IV (12 bytes), Auth Tag (16 bytes), and Ciphertext
  const iv = encryptedBuffer.subarray(0, 12);
  const tag = encryptedBuffer.subarray(12, 28);
  const ciphertext = encryptedBuffer.subarray(28);

  const hexKey = process.env.AES_ENCRYPTION_KEY || '6b8d9c2a1e4f5a3b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  decipher.setAuthTag(tag);

  let decryptedDbBuffer;
  try {
    decryptedDbBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    console.log('[RESTORE TEST] AES-256-GCM authentication and decryption: SUCCESS');
  } catch (err) {
    throw new Error(`Decryption failed! Authentication tag mismatch or corrupt backup: ${err.message}`);
  }

  // Compute restored SHA-256
  const restoredSha256 = crypto.createHash('sha256').update(decryptedDbBuffer).digest('hex');
  console.log(`[RESTORE TEST] Restored database SHA-256 checksum: ${restoredSha256}`);

  // Write to ISOLATED test database (never live DB!)
  if (fs.existsSync(testRestoredDbPath)) {
    fs.unlinkSync(testRestoredDbPath);
  }
  fs.writeFileSync(testRestoredDbPath, decryptedDbBuffer);
  console.log(`[RESTORE TEST] Written to isolated sandbox: ${testRestoredDbPath}`);

  // Query restored database to verify structure and content
  const testDb = new sqlite3.Database(testRestoredDbPath);

  const testQuery = (sql) =>
    new Promise((resolve, reject) => {
      testDb.all(sql, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  const tables = await testQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const users = await testQuery('SELECT id, username, email, role_id FROM users');
  const classes = await testQuery('SELECT * FROM classes');
  const grades = await testQuery('SELECT * FROM grades');

  testDb.close();

  console.log('----------------------------------------------------');
  console.log('[RESTORE TEST] INTEGRITY VERIFICATION REPORT');
  console.log(`- Tables restored: ${tables.length}`);
  console.log(`- User records restored: ${users.length}`);
  console.log(`- Classes restored: ${classes.length}`);
  console.log(`- Grades restored: ${grades.length}`);
  console.log('- Status: RESTORE TEST PASSED 100%');
  console.log('----------------------------------------------------');

  return {
    success: true,
    backupFile: fileToRestore,
    restoredSha256,
    tablesCount: tables.length,
    usersCount: users.length,
    classesCount: classes.length,
    gradesCount: grades.length,
  };
}

if (process.argv[1] && process.argv[1].endsWith('restore.js')) {
  verifyRestoreTest()
    .then((res) => {
      console.log('Standalone restore verification completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Standalone restore verification failed:', err);
      process.exit(1);
    });
}

export default {
  verifyRestoreTest,
};
