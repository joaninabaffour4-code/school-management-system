import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import dotenv from 'dotenv';
import { encryptData, decryptData } from './crypto.js';

dotenv.config();

const issuer = process.env.MFA_ISSUER || 'School Management System';

// Configure TOTP window (2 steps before/after = 60s tolerance for device clock drift)
authenticator.options = {
  window: 2,
};

/**
 * Generate a new TOTP secret, QR code, and encrypted payload for storage.
 * @param {string} username - User account identifier
 * @returns {Promise<{ secret: string, otpauthUrl: string, qrCodeDataUrl: string, encryptedSecret: { encrypted: string, iv: string, tag: string } }>}
 */
export async function generateTotpSetup(username) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(username, issuer, secret);
  const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
  const encryptedSecret = encryptData(secret);

  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl,
    encryptedSecret,
  };
}

/**
 * Verify a 6-digit TOTP code against an encrypted secret.
 * @param {string} token - 6-digit one-time code submitted by user
 * @param {string} encryptedSecret - AES-256-GCM ciphertext
 * @param {string} iv - Hex IV
 * @param {string} tag - Hex auth tag
 * @returns {boolean} - True if valid, false otherwise
 */
export function verifyTotpToken(token, encryptedSecret, iv, tag) {
  if (!token || !encryptedSecret || !iv || !tag) return false;
  try {
    const plainSecret = decryptData(encryptedSecret, iv, tag);
    return authenticator.check(token, plainSecret);
  } catch (err) {
    console.error('TOTP verification error (decryption or check failed):', err.message);
    return false;
  }
}

export default {
  generateTotpSetup,
  verifyTotpToken,
};
