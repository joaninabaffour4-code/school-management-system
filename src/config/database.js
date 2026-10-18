import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let defaultDbPath = path.join(__dirname, '..', '..', 'data', 'bajonas_closet.db');
let dbPath = process.env.DB_FILE || defaultDbPath;

// Support Vercel serverless environment (writable /tmp sandbox)
if (process.env.VERCEL) {
  const tmpDir = '/tmp';
  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  } catch (e) {}
  const tmpDbPath = path.join(tmpDir, 'bajonas_closet.db');
  const seedDbPath = path.join(__dirname, '..', '..', 'data', 'seeds', 'school_system_seed.db');
  try {
    if (!fs.existsSync(tmpDbPath)) {
      if (fs.existsSync(seedDbPath)) {
        fs.copyFileSync(seedDbPath, tmpDbPath);
        console.log('[DB] Initialized /tmp DB from seedDbPath');
      } else if (fs.existsSync(defaultDbPath)) {
        fs.copyFileSync(defaultDbPath, tmpDbPath);
      }
    }
  } catch (e) {
    console.warn('[DB] Vercel /tmp copy note:', e.message);
  }
  dbPath = tmpDbPath;
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

import { scheduleS3Sync } from '../utils/s3Sync.js';

export const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/i.test(sql);
        if (isWrite && process.env.VERCEL) {
          scheduleS3Sync();
        }
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });

export const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

export const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

export default db;
