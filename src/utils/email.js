import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const appUrl = process.env.APP_URL || 'http://localhost:3000';
const mode = process.env.EMAIL_SERVICE_MODE || 'console';

let transporter = null;
if (mode === 'smtp' && process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Generate a cryptographically secure, unpredictable, single-use token and 24h expiry date.
 */
export function generateTokenAndExpiry(hoursValid = 24) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + hoursValid * 60 * 60 * 1000).toISOString();
  return { token, expiresAt };
}

/**
 * Send an email verification message.
 * @param {string} email - Recipient email
 * @param {string} username - Recipient username
 * @param {string} token - Verification token
 * @returns {Promise<{ success: boolean, verificationUrl: string }>}
 */
export async function sendVerificationEmail(email, username, token) {
  const verificationUrl = `${appUrl}/verify-email?token=${token}`;

  console.log('----------------------------------------------------');
  console.log(`[EMAIL SERVICE] Sending Email Verification`);
  console.log(`To: ${email} (${username})`);
  console.log(`Verification URL: ${verificationUrl}`);
  console.log('----------------------------------------------------');

  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"School Administration" <noreply@school.edu>',
        to: email,
        subject: 'Verify your School Management System account',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome to School Management System</h2>
            <p>Hello <strong>${username}</strong>,</p>
            <p>Please click the link below to verify your email address and activate your account:</p>
            <p><a href="${verificationUrl}" style="background: #1e3a8a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">Verify Email</a></p>
            <p>Or paste this URL in your browser: <br>${verificationUrl}</p>
            <p><em>This link is single-use and will expire in 24 hours.</em></p>
          </div>
        `,
      });
    } catch (err) {
      console.error('[EMAIL SERVICE] Failed to deliver SMTP email:', err.message);
    }
  }

  return { success: true, verificationUrl };
}

/**
 * Send a password recovery link.
 */
export async function sendPasswordResetEmail(email, username, token) {
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  console.log('----------------------------------------------------');
  console.log(`[EMAIL SERVICE] Sending Password Reset Link`);
  console.log(`To: ${email} (${username})`);
  console.log(`Reset URL: ${resetUrl}`);
  console.log('----------------------------------------------------');

  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"School Administration" <noreply@school.edu>',
        to: email,
        subject: 'Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Password Reset</h2>
            <p>Hello <strong>${username}</strong>,</p>
            <p>You requested a password reset. Click the button below to set a new password:</p>
            <p><a href="${resetUrl}" style="background: #1e3a8a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
            <p>Or paste this URL in your browser: <br>${resetUrl}</p>
            <p><em>This link will expire in 1 hour. If you did not request this, you can safely ignore this email.</em></p>
          </div>
        `,
      });
    } catch (err) {
      console.error('[EMAIL SERVICE] Failed to deliver SMTP email:', err.message);
    }
  }

  return { success: true, resetUrl };
}

export default {
  generateTokenAndExpiry,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
