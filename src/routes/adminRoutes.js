import express from 'express';
import { all, get, run } from '../config/database.js';
import { authenticate, requireEmailVerified, authorize, recordAuditLog } from '../middleware/authMiddleware.js';
import { hashPassword } from '../utils/password.js';
import { runDatabaseBackup } from '../utils/backup.js';

const router = express.Router();

// Enforce Administrator role and mandatory email verification
router.use(authenticate);
router.use(requireEmailVerified);
router.use(authorize('Administrator', 'admin'));

/**
 * GET /api/admin/stats
 * Real-time school statistics calculated from database records.
 */
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await get('SELECT COUNT(*) AS count FROM users');
    const totalTeachers = await get('SELECT COUNT(*) AS count FROM teachers');
    const totalStudents = await get('SELECT COUNT(*) AS count FROM students');
    const totalGuardians = await get('SELECT COUNT(*) AS count FROM guardians');
    const totalClasses = await get('SELECT COUNT(*) AS count FROM classes');
    const totalSubjects = await get('SELECT COUNT(*) AS count FROM subjects');
    const recentAudit = await all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5');
    const lastBackup = await get('SELECT * FROM backup_logs ORDER BY created_at DESC LIMIT 1');

    return res.json({
      totalUsers: totalUsers.count,
      totalTeachers: totalTeachers.count,
      totalStudents: totalStudents.count,
      totalGuardians: totalGuardians.count,
      totalClasses: totalClasses.count,
      totalSubjects: totalSubjects.count,
      lastBackup,
      recentAudit,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ message: 'Failed to compute school statistics.' });
  }
});

/**
 * GET /api/admin/users
 * Search, filter, and list accounts with role and profile metadata.
 */
router.get('/users', async (req, res) => {
  try {
    const { role, search } = req.query;
    let query = `
      SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.phone,
             u.status, u.is_email_verified, u.is_2fa_enabled, u.created_at,
             r.name AS role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ` AND (r.name = ? OR (r.name = 'admin' AND ? = 'Administrator'))`;
      params.push(role, role);
    }

    if (search) {
      query += ` AND (u.username LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY u.id DESC';
    const users = await all(query, params);
    return res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    return res.status(500).json({ message: 'Failed to retrieve user accounts.' });
  }
});

/**
 * POST /api/admin/users
 * Administrator user creation with role-specific profile generation.
 */
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role, phone } = req.body;

    if (!username || !email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ message: 'All user profile fields are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await get('SELECT id FROM users WHERE username = ? OR email = ?', [cleanUsername, cleanEmail]);
    if (existing) {
      return res.status(409).json({ message: 'Username or email is already registered.' });
    }

    const roleRecord = await get('SELECT id FROM roles WHERE name = ?', [role]);
    if (!roleRecord) {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    const passwordHash = await hashPassword(password);
    const result = await run(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role_id, phone, is_email_verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
      [cleanUsername, cleanEmail, passwordHash, firstName.trim(), lastName.trim(), roleRecord.id, phone || null]
    );

    const newUserId = result.id;

    // Create role profile
    if (role === 'Teacher') {
      const empId = `TCH-${String(newUserId).padStart(3, '0')}`;
      await run('INSERT INTO teachers (user_id, employee_id) VALUES (?, ?)', [newUserId, empId]);
    } else if (role === 'Student') {
      const admNo = `STU-${new Date().getFullYear()}-${String(newUserId).padStart(4, '0')}`;
      await run('INSERT INTO students (user_id, admission_number) VALUES (?, ?)', [newUserId, admNo]);
    } else if (role === 'Parent/Guardian') {
      await run('INSERT INTO guardians (user_id, emergency_phone) VALUES (?, ?)', [newUserId, phone || null]);
    }

    await recordAuditLog(req.user.id, 'CREATE_USER', 'users', newUserId, { username: cleanUsername, role });

    return res.status(201).json({
      message: 'User created successfully.',
      userId: newUserId,
      username: cleanUsername,
      role,
    });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ message: 'Failed to create user.' });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * Activate, suspend, or deactivate accounts.
 */
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'deactivated'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value.' });
    }

    if (Number(id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot suspend or deactivate your own account.' });
    }

    await run('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    await recordAuditLog(req.user.id, 'UPDATE_USER_STATUS', 'users', id, { newStatus: status });

    return res.json({ message: `Account status updated to ${status}.` });
  } catch (err) {
    console.error('Update status error:', err);
    return res.status(500).json({ message: 'Failed to update user status.' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user account.
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (Number(id) === req.user.id) {
      return res.status(400).json({ message: 'Administrator cannot delete their own account.' });
    }

    const user = await get('SELECT id, username FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await run('DELETE FROM users WHERE id = ?', [id]);
    await recordAuditLog(req.user.id, 'DELETE_USER', 'users', id, { username: user.username });

    return res.json({ message: 'User account deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ message: 'Failed to delete user.' });
  }
});

/**
 * POST /api/admin/guardians/link
 * Authoritative backend link between Parent/Guardian and Student.
 */
router.post('/guardians/link', async (req, res) => {
  try {
    const { guardianId, studentId, relationship } = req.body;

    if (!guardianId || !studentId) {
      return res.status(400).json({ message: 'Guardian ID and Student ID are required.' });
    }

    const guardian = await get('SELECT id FROM guardians WHERE id = ?', [guardianId]);
    const student = await get('SELECT id FROM students WHERE id = ?', [studentId]);

    if (!guardian || !student) {
      return res.status(404).json({ message: 'Guardian or Student record does not exist.' });
    }

    await run(
      `INSERT INTO guardian_students (guardian_id, student_id, relationship)
       VALUES (?, ?, ?)
       ON CONFLICT(guardian_id, student_id) DO UPDATE SET relationship = excluded.relationship`,
      [guardianId, studentId, relationship || 'Parent']
    );

    await recordAuditLog(req.user.id, 'LINK_GUARDIAN_STUDENT', 'guardian_students', `${guardianId}-${studentId}`);
    return res.json({ message: 'Parent/Guardian successfully linked to student.' });
  } catch (err) {
    console.error('Link guardian error:', err);
    return res.status(500).json({ message: 'Failed to link guardian to student.' });
  }
});

/**
 * POST /api/admin/classes
 * Create a new school class.
 */
router.post('/classes', async (req, res) => {
  try {
    const { name, gradeLevel, capacity } = req.body;
    if (!name || !gradeLevel) {
      return res.status(400).json({ message: 'Class name and grade level are required.' });
    }

    const result = await run('INSERT INTO classes (name, grade_level, capacity) VALUES (?, ?, ?)', [
      name.trim(),
      gradeLevel.trim(),
      Number(capacity) || 35,
    ]);

    await recordAuditLog(req.user.id, 'CREATE_CLASS', 'classes', result.id, { name });
    return res.status(201).json({ message: 'Class created successfully.', classId: result.id });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to create class: ' + err.message });
  }
});

/**
 * GET /api/admin/classes
 * List all classes with student count.
 */
router.get('/classes', async (req, res) => {
  try {
    const classes = await all(`
      SELECT c.*, COUNT(e.id) AS enrolled_students
      FROM classes c
      LEFT JOIN class_enrollments e ON c.id = e.class_id
      GROUP BY c.id
      ORDER BY c.name
    `);
    return res.json(classes);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve classes.' });
  }
});

/**
 * POST /api/admin/enrollments
 * Authoritatively enroll a student into a class.
 */
router.post('/enrollments', async (req, res) => {
  try {
    const { studentId, classId, academicYearId } = req.body;
    if (!studentId || !classId) {
      return res.status(400).json({ message: 'Student ID and Class ID are required.' });
    }

    let yearId = academicYearId;
    if (!yearId) {
      const currentYear = await get('SELECT id FROM academic_years WHERE is_current = 1');
      yearId = currentYear ? currentYear.id : 1;
    }

    await run(
      `INSERT INTO class_enrollments (student_id, class_id, academic_year_id)
       VALUES (?, ?, ?)
       ON CONFLICT(student_id, class_id, academic_year_id) DO UPDATE SET status = 'enrolled'`,
      [studentId, classId, yearId]
    );

    await recordAuditLog(req.user.id, 'ENROLL_STUDENT', 'class_enrollments', `${studentId}-${classId}`);
    return res.json({ message: 'Student successfully enrolled in class.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to enroll student: ' + err.message });
  }
});

/**
 * POST /api/admin/teachers/assign
 * Authoritatively assign a teacher to a subject and class.
 */
router.post('/teachers/assign', async (req, res) => {
  try {
    const { teacherId, subjectId, classId } = req.body;
    if (!teacherId || !subjectId || !classId) {
      return res.status(400).json({ message: 'Teacher, Subject, and Class are required.' });
    }

    await run(
      `INSERT INTO teacher_subjects (teacher_id, subject_id, class_id)
       VALUES (?, ?, ?)
       ON CONFLICT(teacher_id, subject_id, class_id) DO NOTHING`,
      [teacherId, subjectId, classId]
    );

    await recordAuditLog(req.user.id, 'ASSIGN_TEACHER', 'teacher_subjects', `${teacherId}-${subjectId}-${classId}`);
    return res.json({ message: 'Teacher assigned to subject and class successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to assign teacher.' });
  }
});

/**
 * GET /api/admin/grades/review
 * Review submitted assessment grades across all classes.
 */
router.get('/grades/review', async (req, res) => {
  try {
    const grades = await all(`
      SELECT g.id, g.marks_obtained, g.grade_letter, g.remarks, g.is_approved_by_admin, g.is_published,
             a.title AS assessment_title, a.max_marks,
             c.name AS class_name,
             sub.name AS subject_name,
             u.first_name || ' ' || u.last_name AS student_name,
             s.admission_number
      FROM grades g
      JOIN assessments a ON g.assessment_id = a.id
      JOIN classes c ON a.class_id = c.id
      JOIN subjects sub ON a.subject_id = sub.id
      JOIN students s ON g.student_id = s.id
      JOIN users u ON s.user_id = u.id
      ORDER BY g.id DESC
    `);
    return res.json(grades);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve grades.' });
  }
});

/**
 * PATCH /api/admin/grades/publish
 * Approve and publish grades so students and parents can view report cards.
 */
router.patch('/grades/publish', async (req, res) => {
  try {
    const { gradeIds } = req.body; // array of IDs, or null to publish all pending
    if (Array.isArray(gradeIds) && gradeIds.length > 0) {
      const placeholders = gradeIds.map(() => '?').join(',');
      await run(`UPDATE grades SET is_approved_by_admin = 1, is_published = 1 WHERE id IN (${placeholders})`, gradeIds);
    } else {
      await run('UPDATE grades SET is_approved_by_admin = 1, is_published = 1');
    }

    await recordAuditLog(req.user.id, 'PUBLISH_GRADES', 'grades', 'bulk');
    return res.json({ message: 'Grades successfully approved and published for students and parents.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to publish grades.' });
  }
});

/**
 * GET & POST /api/admin/announcements
 * Broadcast official announcements.
 */
router.get('/announcements', async (req, res) => {
  try {
    const list = await all(`
      SELECT a.*, u.first_name || ' ' || u.last_name AS author
      FROM announcements a
      JOIN users u ON a.created_by_user_id = u.id
      ORDER BY a.created_at DESC
    `);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch announcements.' });
  }
});

router.post('/announcements', async (req, res) => {
  try {
    const { title, content, targetRole } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required.' });
    }

    const result = await run(
      'INSERT INTO announcements (title, content, target_role, created_by_user_id) VALUES (?, ?, ?, ?)',
      [title.trim(), content.trim(), targetRole || 'all', req.user.id]
    );

    await recordAuditLog(req.user.id, 'POST_ANNOUNCEMENT', 'announcements', result.id);
    return res.status(201).json({ message: 'Announcement published successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to publish announcement.' });
  }
});

/**
 * GET /api/admin/audit-logs
 * System security and operation audit trail.
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await all(`
      SELECT a.*, u.username, u.email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch audit logs.' });
  }
});

/**
 * GET & POST /api/admin/backups
 * View automated backup status and trigger on-demand backups.
 */
router.get('/backups', async (req, res) => {
  try {
    const backups = await all('SELECT * FROM backup_logs ORDER BY created_at DESC LIMIT 50');
    return res.json(backups);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch backup logs.' });
  }
});

router.post('/backups/run', async (req, res) => {
  try {
    const result = await runDatabaseBackup('manual_admin_trigger');
    await recordAuditLog(req.user.id, 'RUN_BACKUP', 'backup_logs', result.filename);
    return res.json({ message: 'Backup executed successfully.', backup: result });
  } catch (err) {
    return res.status(500).json({ message: 'Backup execution failed: ' + err.message });
  }
});

export default router;
