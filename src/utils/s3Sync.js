import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3Region = process.env.AWS_REGION || 'eu-north-1';
const s3Bucket = process.env.AWS_S3_BACKUP_BUCKET || 'nina---backup';
const S3_KEY = 'live-database/bajonas_closet.db';

let s3 = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3 = new S3Client({
    region: s3Region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

let isSyncing = false;
let syncQueued = false;
let lastSyncPromise = Promise.resolve();

export function getDbFilePath() {
  if (process.env.VERCEL) {
    return path.join('/tmp', 'bajonas_closet.db');
  }
  return process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'bajonas_closet.db');
}

/**
 * Downloads the persistent database from S3 if configured.
 */
export async function downloadDbFromS3() {
  if (!s3) return false;

  const localPath = getDbFilePath();
  const dir = path.dirname(localPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {}

  try {
    console.log(`[S3-SYNC] Checking persistent database at s3://${s3Bucket}/${S3_KEY} ...`);
    const getRes = await s3.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: S3_KEY,
      })
    );

    const chunks = [];
    for await (const chunk of getRes.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(localPath, buffer);
    console.log(`[S3-SYNC] Successfully downloaded persistent database (${buffer.length} bytes) to ${localPath}`);
    return true;
  } catch (err) {
    console.warn(`[S3-SYNC] Could not download database from S3 (${err.message}). Using local seed.`);
    return false;
  }
}

/**
 * Uploads current SQLite database file to S3 if configured.
 */
export async function uploadDbToS3() {
  if (!s3) return;

  const localPath = getDbFilePath();
  if (!fs.existsSync(localPath)) return;

  try {
    const fileBuffer = fs.readFileSync(localPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: S3_KEY,
        Body: fileBuffer,
        ContentType: 'application/x-sqlite3',
      })
    );
    console.log(`[S3-SYNC] Persisted database to s3://${s3Bucket}/${S3_KEY} (${fileBuffer.length} bytes)`);
  } catch (err) {
    console.error('[S3-SYNC] Failed to upload database to S3:', err.message);
  }
}

/**
 * Triggered automatically on database write operations (INSERT/UPDATE/DELETE).
 */
export function scheduleS3Sync() {
  if (!s3 || !process.env.VERCEL) return Promise.resolve();

  if (isSyncing) {
    syncQueued = true;
    return lastSyncPromise;
  }

  isSyncing = true;
  lastSyncPromise = (async () => {
    try {
      await uploadDbToS3();
    } finally {
      isSyncing = false;
      if (syncQueued) {
        syncQueued = false;
        scheduleS3Sync();
      }
    }
  })();

  return lastSyncPromise;
}

export function waitForPendingSync() {
  return lastSyncPromise;
}

export default {
  downloadDbFromS3,
  uploadDbToS3,
  scheduleS3Sync,
  waitForPendingSync,
  getDbFilePath,
};
