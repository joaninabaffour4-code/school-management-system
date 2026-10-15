import { verifyToken } from '../utils/auth.js';
import { get, run } from '../config/database.js';

/**
 * Standard authentication middleware: verifies Bearer JWT and loads user record from DB.
 */
export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required. Missing or malformed Authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);

    if (decoded.twoFactorPending) {
      return res.status(401).json({ message: 'Two-factor authentication pending. Complete 2FA verification first.' });
    }

    const user = await get(
      `SELECT u.*, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists.' });
    }

    if (user.status && user.status !== 'active') {
      return res.status(403).json({ message: `Account is ${user.status}. Please contact the school administrator.` });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired session token.' });
  }
};

/**
 * Enforces mandatory email verification before allowing access to protected school features.
 */
export const requireEmailVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  if (!req.user.is_email_verified) {
    return res.status(403).json({
      message: 'Email verification required. Please verify your email address to access this portal.',
      emailVerificationRequired: true,
      email: req.user.email,
    });
  }

  next();
};

/**
 * Role-Based Access Control (RBAC) middleware.
 * Supports normalization between legacy role names (e.g. 'admin') and school role names ('Administrator').
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const currentRole = req.user.role;
    // Map legacy roles if needed
    const normalizedRole = currentRole === 'admin' ? 'Administrator' : currentRole;

    const isAllowed = allowedRoles.some((role) => {
      if (role === 'Administrator' && (currentRole === 'admin' || currentRole === 'Administrator')) return true;
      if (role === 'admin' && (currentRole === 'admin' || currentRole === 'Administrator')) return true;
      return role === currentRole || role === normalizedRole;
    });

    if (!isAllowed) {
      return res.status(403).json({
        message: 'Access denied: You do not possess the required permissions for this school resource.',
        requiredRoles: allowedRoles,
        userRole: currentRole,
      });
    }

    next();
  };
};

/**
 * Helper to record security and academic audit logs in the database.
 */
export const recordAuditLog = async (userId, action, resourceType, resourceId = null, details = null) => {
  try {
    await run(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, resourceType, resourceId ? String(resourceId) : null, typeof details === 'object' ? JSON.stringify(details) : details]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
};

export default {
  authenticate,
  requireEmailVerified,
  authorize,
  recordAuditLog,
};
