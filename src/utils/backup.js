import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { run, get } from '../config/database.js';
import { encryptData } from './crypto.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultDbPath = path.join(__dirname, '..', '..', 'data', 'bajonas_closet.db');
const dbSourcePath = process.env.VERCEL
  ? path.join('/tmp', 'bajonas_closet.db')
  : (process.env.DB_FILE || defaultDbPath);
const localBackupDir = process.env.VERCEL
  ? path.join('/tmp', 'backups')
  : path.join(__dirname, '..', '..', 'data', 'backups');

try {
  if (!fs.existsSync(localBackupDir)) {
    fs.mkdirSync(localBackupDir, { recursive: true });
  }
} catch (e) {
  console.warn('[BACKUP] Notice on backup directory creation:', e.message);
}

const s3Region = process.env.AWS_REGION || 'eu-north-1';
const s3Bucket = process.env.AWS_S3_BACKUP_BUCKET || 'nina---backup';
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

let s3Client = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: s3Region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
} else {
  // Uses AWS default credential provider chain (IAM Roles on EC2 / ECS / Lambda)
  try {
    s3Client = new S3Client({ region: s3Region });
  } catch (e) {
    s3Client = null;
  }
}

/**
 * Execute automated database backup.
 * 1. Safely copies live SQLite database
 * 2. Computes SHA-256 integrity hash
 * 3. Encrypts with AES-256-GCM
 * 4. Uploads to AWS S3 private bucket (with local fallback)
 * 5. Applies retention policy
 * 6. Records execution in backup_logs
 */
export async function runDatabaseBackup(triggerSource = 'scheduled_cron') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `school-backup-${timestamp}.db.enc`;
  const metaFileName = `school-backup-${timestamp}.meta.json`;
  const localEncryptedPath = path.join(localBackupDir, backupFileName);

  console.log(`[BACKUP] Starting automated backup (trigger: ${triggerSource})...`);

  if (!fs.existsSync(dbSourcePath)) {
    if (fs.existsSync(defaultDbPath)) {
      try {
        fs.copyFileSync(defaultDbPath, dbSourcePath);
      } catch (e) {}
    }
  }
  if (!fs.existsSync(dbSourcePath)) {
    throw new Error(`Primary database file not found at ${dbSourcePath}`);
  }

  // 1. Read source database buffer safely
  const rawDbBuffer = fs.readFileSync(dbSourcePath);
  const sha256 = crypto.createHash('sha256').update(rawDbBuffer).digest('hex');

  // 2. Encrypt using AES-256-GCM authenticated cipher
  const hexKey = process.env.AES_ENCRYPTION_KEY || '6b8d9c2a1e4f5a3b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);

  const encryptedBuffer = Buffer.concat([cipher.update(rawDbBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine IV (12 bytes) + Tag (16 bytes) + Encrypted Payload
  const finalEncryptedFileBuffer = Buffer.concat([iv, authTag, encryptedBuffer]);
  fs.writeFileSync(localEncryptedPath, finalEncryptedFileBuffer);

  const metadata = {
    timestamp: new Date().toISOString(),
    trigger: triggerSource,
    originalSize: rawDbBuffer.length,
    encryptedSize: finalEncryptedFileBuffer.length,
    sha256,
    algorithm: 'aes-256-gcm',
    ivLength: 12,
    tagLength: 16,
  };
  fs.writeFileSync(path.join(localBackupDir, metaFileName), JSON.stringify(metadata, null, 2));

  let s3Etag = null;
  let destination = 'local_protected_storage';

  // 3. Upload to AWS S3 if client and bucket configured
  if (s3Client && s3Bucket) {
    try {
      const s3Key = `database-backups/${backupFileName}`;
      const uploadCommand = new PutObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
        Body: finalEncryptedFileBuffer,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256', // AWS managed encryption at rest in S3
        Metadata: {
          sha256Checksum: sha256,
          originalSize: String(rawDbBuffer.length),
        },
      });

      const s3Response = await s3Client.send(uploadCommand);
      s3Etag = s3Response.ETag;
      destination = `s3://${s3Bucket}/${s3Key}`;
      console.log(`[BACKUP] Successfully uploaded encrypted backup to AWS S3: ${destination} (ETag: ${s3Etag})`);
    } catch (s3Err) {
      console.warn(`[BACKUP] AWS S3 upload could not be completed (${s3Err.message}). Backup preserved in local secure storage: ${localEncryptedPath}`);
      destination = `local_fallback:${localEncryptedPath}`;
    }
  }

  // 4. Record execution in backup_logs database table
  await run(
    `INSERT INTO backup_logs (filename, destination, status, size_bytes, sha256_checksum, s3_etag, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      backupFileName,
      destination,
      'success',
      finalEncryptedFileBuffer.length,
      sha256,
      s3Etag,
      JSON.stringify(metadata),
    ]
  );

  // 5. Apply retention policy: remove local backups older than retentionDays
  applyLocalRetention(retentionDays);

  console.log(`[BACKUP] Completed successfully. Size: ${finalEncryptedFileBuffer.length} bytes, SHA-256: ${sha256.substring(0, 16)}...`);
  return {
    filename: backupFileName,
    destination,
    sizeBytes: finalEncryptedFileBuffer.length,
    sha256,
    s3Etag,
  };
}

/**
 * Retention cleanup for local backup directory.
 */
function applyLocalRetention(days) {
  try {
    const files = fs.readdirSync(localBackupDir);
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(localBackupDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        console.log(`[BACKUP RETENTION] Pruned aged backup file: ${file}`);
      }
    }
  } catch (err) {
    console.error('[BACKUP RETENTION] Pruning error:', err.message);
  }
}

/**
 * Schedule recurring background automated backup cron.
 */
export function initBackupScheduler() {
  const cronExpression = process.env.BACKUP_SCHEDULE_CRON || '0 2 * * *'; // 02:00 AM daily
  console.log(`[BACKUP SCHEDULER] Initialized with cron schedule: "${cronExpression}"`);

  cron.schedule(cronExpression, async () => {
    try {
      await runDatabaseBackup('scheduled_cron');
    } catch (err) {
      console.error('[BACKUP SCHEDULER] Automated backup failed:', err);
      try {
        await run(
          `INSERT INTO backup_logs (filename, destination, status, details)
           VALUES ('failed_job', 'none', 'failed', ?)`,
          [err.message]
        );
      } catch (logErr) {
        // silent
      }
    }
  });
}

// Allow direct CLI execution: `node src/utils/backup.js`
if (process.argv[1] && process.argv[1].endsWith('backup.js')) {
  runDatabaseBackup('cli_manual')
    .then((res) => {
      console.log('CLI Backup completed:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('CLI Backup failed:', err);
      process.exit(1);
    });
}

export default {
  runDatabaseBackup,
  initBackupScheduler,
};
