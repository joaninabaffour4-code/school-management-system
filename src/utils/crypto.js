import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// AES-256-GCM requires a 32-byte key and a 12-byte (96-bit) IV / nonce.
const algorithm = 'aes-256-gcm';

function getEncryptionKey() {
  const hexKey = process.env.AES_ENCRYPTION_KEY || '6b8d9c2a1e4f5a3b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('AES_ENCRYPTION_KEY must be a 64-character hex string (32 bytes / 256 bits)');
  }
  return key;
}

/**
 * Encrypt sensitive text (such as TOTP secrets) using authenticated AES-256-GCM.
 * Each call generates a fresh, cryptographically strong, unpredictable 12-byte IV.
 * @param {string} text - Plaintext to encrypt
 * @returns {{ encrypted: string, iv: string, tag: string }} - Hex encoded ciphertext, IV, and auth tag
 */
export function encryptData(text) {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Recommended 96-bit IV for GCM
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex'); // 16-byte authentication tag

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag,
  };
}

/**
 * Decrypt ciphertext using authenticated AES-256-GCM.
 * Verifies authenticity with the 16-byte authentication tag before returning data.
 * @param {string} encryptedHex - Hex encoded ciphertext
 * @param {string} ivHex - Hex encoded IV
 * @param {string} tagHex - Hex encoded 16-byte auth tag
 * @returns {string} - Decrypted plaintext
 */
export function decryptData(encryptedHex, ivHex, tagHex) {
  if (!encryptedHex || !ivHex || !tagHex) return null;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8'); // Throws error if authentication tag does not match
  return decrypted;
}

export default {
  encryptData,
  decryptData,
};
