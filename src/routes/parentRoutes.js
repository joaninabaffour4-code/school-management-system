import express from 'express';
import { all, get, run } from '../config/database.js';
import { authenticate, requireEmailVerified, authorize, recordAuditLog } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(requireEmailVerified);
router.use(authorize('Parent/Guardian'));

async function getGuardianRecord(userId) {
  return get('SELECT * FROM guardians WHERE user_id = ?', [userId]);
}

/**
 * Middleware: Verifies that the requested studentId is officially linked to this guardian in guardian_students.
 * Prevents IDOR (Insecure Direct Object Reference) vulnerabilities.
 */
async function verifyLinkedStudent(req, res, next) {
  try {
    const guardian = await getGuardianRecord(req.user.id);
    if (!guardian) {
      return res.status(404).json({ message: 'Parent/Guardian profile not found.' });
    }

    const { studentId } = req.params;
    const link = await get(
      'SELECT id, relationship FROM guardian_students WHERE guardian_id = ? AND student_id = ?',
      [guardian.id, studentId]
    );

    if (!link) {
      return res.status(403).json({
        message: 'Access denied: You are not authorized to access records for this student.',
      });
    }

    req.guardian = guardian;
    req.studentLink = link;
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Authorization verification failed.' });
  }
}

/**
 * GET /api/parent/profile
 */
router.get('/profile', async (req, res) => {
  try {
    const guardian = await get(
      `SELECT g.*, u.username, u.email, u.first_name, u.last_name, u.phone
       FROM guardians g
       JOIN users u ON g.user_id = u.id
       WHERE g.user_id = ?`,
      [req.user.id]
    );
    return res.json(guardian);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch profile.' });
  }
});

/**
 * PATCH /api/parent/profile
 * Update contact details.
 */
router.patch('/profile', async (req, res) => {
  try {
    const { phone, emergencyPhone, address } = req.body;
    if (phone) {
      await run('UPDATE users SET phone = ? WHERE id = ?', [phone, req.user.id]);
    }
    if (emergencyPhone || address) {
      await run('UPDATE guardians SET emergency_phone = ?, address = ? WHERE user_id = ?', [
        emergencyPhone || null,
        address || null,
        req.user.id,
      ]);
    }
    await recordAuditLog(req.user.id, 'UPDATE_PARENT_PROFILE', 'guardians', req.user.id);
    return res.json({ message: 'Contact details updated successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update contact details.' });
  }
});

/**
 * GET /api/parent/children
 * Lists all officially linked children (supports multiple children per parent).
 */
router.get('/children', async (req, res) => {
  try {
    const guardian = await getGuardianRecord(req.user.id);
    if (!guardian) return res.status(404).json({ message: 'Guardian profile not found.' });

    const children = await all(
      `SELECT s.id AS student_id, s.admission_number, s.date_of_birth, s.gender,
              u.first_name, u.last_name, u.email,
              gs.relationship,
              c.name AS class_name
       FROM guardian_students gs
       JOIN students s ON gs.student_id = s.id
       JOIN users u ON s.user_id = u.id
       LEFT JOIN class_enrollments ce ON s.id = ce.student_id AND ce.status = 'enrolled'
       LEFT JOIN classes c ON ce.class_id = c.id
       WHERE gs.guardian_id = ?
       ORDER BY u.first_name`,
      [guardian.id]
    );

    return res.json(children);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch children.' });
  }
});

/**
 * GET /api/parent/children/:studentId/attendance
 * Authoritative child attendance view.
 */
router.get('/children/:studentId/attendance', verifyLinkedStudent, async (req, res) => {
  try {
    const { studentId } = req.params;
    const records = await all(
      `SELECT a.date, a.status, a.notes, c.name AS class_name
       FROM attendance a
       JOIN classes c ON a.class_id = c.id
       WHERE a.student_id = ?
       ORDER BY a.date DESC`,
      [studentId]
    );

    const stats = {
      total: records.length,
      present: records.filter((r) => r.status === 'present').length,
      absent: records.filter((r) => r.status === 'absent').length,
      late: records.filter((r) => r.status === 'late').length,
    };
    stats.percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 100;

    return res.json({ records, stats });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch child attendance.' });
  }
});

/**
 * GET /api/parent/children/:studentId/grades
 * Authoritative child published grades / report cards view.
 */
router.get('/children/:studentId/grades', verifyLinkedStudent, async (req, res) => {
  try {
    const { studentId } = req.params;
    const grades = await all(
      `SELECT g.marks_obtained, g.grade_letter, g.remarks,
              a.title AS assessment_title, a.type AS assessment_type, a.max_marks,
              sub.name AS subject_name, sub.code AS subject_code
       FROM grades g
       JOIN assessments a ON g.assessment_id = a.id
       JOIN subjects sub ON a.subject_id = sub.id
       WHERE g.student_id = ?
         AND g.is_approved_by_admin = 1
         AND g.is_published = 1
       ORDER BY sub.name, a.title`,
      [studentId]
    );

    return res.json(grades);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch child grades.' });
  }
});

/**
 * GET /api/parent/children/:studentId/timetables
 * Child's timetable view.
 */
router.get('/children/:studentId/timetables', verifyLinkedStudent, async (req, res) => {
  try {
    const { studentId } = req.params;
    const schedule = await all(
      `SELECT t.*, s.name AS subject_name, s.code AS subject_code,
              u.first_name || ' ' || u.last_name AS teacher_name, c.name AS class_name
       FROM class_enrollments ce
       JOIN timetables t ON ce.class_id = t.class_id
       JOIN subjects s ON t.subject_id = s.id
       JOIN classes c ON t.class_id = c.id
       JOIN teachers tch ON t.teacher_id = tch.id
       JOIN users u ON tch.user_id = u.id
       WHERE ce.student_id = ? AND ce.status = 'enrolled'
       ORDER BY CASE t.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 ELSE 6 END, t.start_time`,
      [studentId]
    );
    return res.json(schedule);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch child timetable.' });
  }
});

/**
 * GET /api/parent/announcements
 */
router.get('/announcements', async (req, res) => {
  try {
    const list = await all(`
      SELECT * FROM announcements
      WHERE target_role IN ('all', 'Parent/Guardian')
      ORDER BY created_at DESC
    `);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch announcements.' });
  }
});

export default router;
