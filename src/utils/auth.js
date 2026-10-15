import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-school-secret-jwt-key';

/**
 * Create a full authenticated JWT session token (8 hours).
 */
export const createToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isEmailVerified: Boolean(user.is_email_verified),
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};

/**
 * Create a short-lived temporary token for 2FA challenge (5 minutes).
 */
export const createTemp2faToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      twoFactorPending: true,
    },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
};

/**
 * Verify any JWT token.
 */
export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

/**
 * Simple in-memory rate limiter for brute-force protection on authentication endpoints.
 */
const attemptsMap = new Map();

export const checkRateLimit = (key, maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const now = Date.now();
  const record = attemptsMap.get(key) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }

  record.count += 1;
  attemptsMap.set(key, record);

  if (record.count > maxAttempts) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, remainingAttempts: maxAttempts - record.count };
};

export const resetRateLimit = (key) => {
  attemptsMap.delete(key);
};

export default {
  createToken,
  createTemp2faToken,
  verifyToken,
  checkRateLimit,
  resetRateLimit,
};
