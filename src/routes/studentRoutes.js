import express from 'express';
import { all, get, run } from '../config/database.js';
import { authenticate, requireEmailVerified, authorize, recordAuditLog } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(requireEmailVerified);
router.use(authorize('Student'));

async function getStudentRecord(userId) {
  return get(
    `SELECT s.*, u.username, u.email, u.first_name, u.last_name, u.phone
     FROM students s
     JOIN users u ON s.user_id = u.id
     WHERE s.user_id = ?`,
    [userId]
  );
}

/**
 * GET /api/student/profile
 */
router.get('/profile', async (req, res) => {
  try {
    const student = await getStudentRecord(req.user.id);
    if (!student) return res.status(404).json({ message: 'Student profile not found.' });
    return res.json(student);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch student profile.' });
  }
});

/**
 * PATCH /api/student/profile
 * Update permitted personal info (phone, emergency contact).
 */
router.patch('/profile', async (req, res) => {
  try {
    const { phone, emergencyContact } = req.body;
    if (phone) {
      await run('UPDATE users SET phone = ? WHERE id = ?', [phone, req.user.id]);
    }
    if (emergencyContact) {
      await run('UPDATE students SET emergency_contact = ? WHERE user_id = ?', [emergencyContact, req.user.id]);
    }
    await recordAuditLog(req.user.id, 'UPDATE_PROFILE', 'students', req.user.id);
    return res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update profile.' });
  }
});

/**
 * GET /api/student/classes
 * Enrolled class and subjects.
 */
router.get('/classes', async (req, res) => {
  try {
    const student = await getStudentRecord(req.user.id);
    const enrollments = await all(
      `SELECT ce.id AS enrollment_id, ce.status, c.id AS class_id, c.name AS class_name, c.grade_level,
              ay.name AS academic_year
       FROM class_enrollments ce
       JOIN classes c ON ce.class_id = c.id
       JOIN academic_years ay ON ce.academic_year_id = ay.id
       WHERE ce.student_id = ? AND ce.status = 'enrolled'`,
      [student.id]
    );

    // Fetch subjects taught in enrolled classes
    const classIds = enrollments.map((e) => e.class_id);
    let subjects = [];
    if (classIds.length > 0) {
      const placeholders = classIds.map(() => '?').join(',');
      subjects = await all(
        `SELECT DISTINCT s.id, s.name, s.code, c.name AS class_name,
                u.first_name || ' ' || u.last_name AS teacher_name
         FROM teacher_subjects ts
         JOIN subjects s ON ts.subject_id = s.id
         JOIN classes c ON ts.class_id = c.id
         JOIN teachers t ON ts.teacher_id = t.id
         JOIN users u ON t.user_id = u.id
         WHERE ts.class_id IN (${placeholders})`,
        classIds
      );
    }

    return res.json({ enrollments, subjects });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch enrolled classes.' });
  }
});

/**
 * GET /api/student/attendance
 * Personal attendance records.
 */
router.get('/attendance', async (req, res) => {
  try {
    const student = await getStudentRecord(req.user.id);
    const records = await all(
      `SELECT a.date, a.status, a.notes, c.name AS class_name
       FROM attendance a
       JOIN classes c ON a.class_id = c.id
       WHERE a.student_id = ?
       ORDER BY a.date DESC`,
      [student.id]
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
    return res.status(500).json({ message: 'Failed to fetch attendance.' });
  }
});

/**
 * GET /api/student/grades
 * View published examination results and report card.
 * Enforces security rule: strictly published and admin-approved records only.
 */
router.get('/grades', async (req, res) => {
  try {
    const student = await getStudentRecord(req.user.id);
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
      [student.id]
    );

    return res.json(grades);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch grades.' });
  }
});

/**
 * GET /api/student/timetables
 */
router.get('/timetables', async (req, res) => {
  try {
    const student = await getStudentRecord(req.user.id);
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
      [student.id]
    );
    return res.json(schedule);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch timetable.' });
  }
});

/**
 * GET /api/student/announcements
 */
router.get('/announcements', async (req, res) => {
  try {
    const list = await all(`
      SELECT * FROM announcements
      WHERE target_role IN ('all', 'Student')
      ORDER BY created_at DESC
    `);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch announcements.' });
  }
});

export default router;
