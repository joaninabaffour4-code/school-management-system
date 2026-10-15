import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Pepper is stored strictly in server environment / secrets manager, separate from database
const pepper = process.env.PEPPER_KEY || 'BajonasClosetPepperKey2026';

/**
 * Hash a password using unique bcrypt salt (cost factor 12) + server-side secret pepper.
 * @param {string} password - Raw password plaintext
 * @returns {Promise<string>} - Resulting bcrypt hash containing algorithm, cost, and unique salt
 */
export const hashPassword = async (password) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  // Combine password with secret pepper before hashing
  const pepperedPassword = `${password}${pepper}`;
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(pepperedPassword, salt);
};

/**
 * Verify a candidate password against the stored bcrypt hash using the server-side pepper.
 * @param {string} password - Raw candidate password
 * @param {string} hashedPassword - Stored modular crypt format hash
 * @returns {Promise<boolean>} - True if match, false otherwise
 */
export const verifyPassword = async (password, hashedPassword) => {
  if (!password || !hashedPassword) return false;
  const pepperedPassword = `${password}${pepper}`;
  return bcrypt.compare(pepperedPassword, hashedPassword);
};

export default {
  hashPassword,
  verifyPassword,
};
