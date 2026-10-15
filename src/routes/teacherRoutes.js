import express from 'express';
import { all, get, run } from '../config/database.js';
import { authenticate, requireEmailVerified, authorize, recordAuditLog } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(requireEmailVerified);
router.use(authorize('Teacher'));

/**
 * Helper to fetch teacher record for the logged-in user.
 */
async function getTeacherRecord(userId) {
  return get('SELECT * FROM teachers WHERE user_id = ?', [userId]);
}

/**
 * GET /api/teacher/classes
 * Lists classes and subjects assigned to this teacher.
 */
router.get('/classes', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    if (!teacher) return res.status(404).json({ message: 'Teacher profile not found.' });

    const classes = await all(
      `SELECT DISTINCT c.id AS class_id, c.name AS class_name, c.grade_level,
              s.id AS subject_id, s.name AS subject_name, s.code AS subject_code
       FROM teacher_subjects ts
       JOIN classes c ON ts.class_id = c.id
       JOIN subjects s ON ts.subject_id = s.id
       WHERE ts.teacher_id = ?
       ORDER BY c.name, s.name`,
      [teacher.id]
    );

    return res.json(classes);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch assigned classes.' });
  }
});

/**
 * GET /api/teacher/classes/:classId/students
 * Lists students enrolled in a specific class assigned to this teacher.
 */
router.get('/classes/:classId/students', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const { classId } = req.params;

    // Verify teacher is authorized for this class
    const assignment = await get(
      'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ?',
      [teacher.id, classId]
    );
    if (!assignment) {
      return res.status(403).json({ message: 'Access denied: You are not assigned to teach this class.' });
    }

    const students = await all(
      `SELECT s.id AS student_id, s.admission_number, u.first_name, u.last_name, u.email
       FROM class_enrollments ce
       JOIN students s ON ce.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE ce.class_id = ? AND ce.status = 'enrolled'
       ORDER BY u.last_name, u.first_name`,
      [classId]
    );

    return res.json(students);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch students.' });
  }
});

/**
 * POST /api/teacher/attendance
 * Records or updates attendance for students in an authorized class.
 */
router.post('/attendance', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const { classId, date, records } = req.body; // records: [ { studentId, status, notes } ]

    if (!classId || !date || !Array.isArray(records)) {
      return res.status(400).json({ message: 'Class ID, date, and attendance records array are required.' });
    }

    // Verify assignment
    const assignment = await get('SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ?', [
      teacher.id,
      classId,
    ]);
    if (!assignment) {
      return res.status(403).json({ message: 'Unauthorized: You are not assigned to this class.' });
    }

    for (const rec of records) {
      await run(
        `INSERT INTO attendance (student_id, class_id, date, status, recorded_by_teacher_id, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, class_id, date) DO UPDATE SET
           status = excluded.status,
           recorded_by_teacher_id = excluded.recorded_by_teacher_id,
           notes = excluded.notes`,
        [rec.studentId, classId, date, rec.status || 'present', teacher.id, rec.notes || null]
      );
    }

    await recordAuditLog(req.user.id, 'RECORD_ATTENDANCE', 'attendance', classId, { date, count: records.length });
    return res.json({ message: 'Attendance recorded successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to record attendance: ' + err.message });
  }
});

/**
 * GET /api/teacher/attendance/:classId
 * Retrieve attendance history for an authorized class.
 */
router.get('/attendance/:classId', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const { classId } = req.params;
    const { date } = req.query;

    const assignment = await get('SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ?', [
      teacher.id,
      classId,
    ]);
    if (!assignment) {
      return res.status(403).json({ message: 'Unauthorized for this class.' });
    }

    let query = `
      SELECT a.*, u.first_name || ' ' || u.last_name AS student_name, s.admission_number
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE a.class_id = ?
    `;
    const params = [classId];
    if (date) {
      query += ' AND a.date = ?';
      params.push(date);
    }
    query += ' ORDER BY a.date DESC, u.last_name ASC';

    const list = await all(query, params);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve attendance.' });
  }
});

/**
 * POST /api/teacher/assessments
 * Create a new assessment / exam for an authorized subject and class.
 */
router.post('/assessments', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const { classId, subjectId, title, type, maxMarks, dueDate } = req.body;

    if (!classId || !subjectId || !title) {
      return res.status(400).json({ message: 'Class, Subject, and Title are required.' });
    }

    const assignment = await get(
      'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ? AND subject_id = ?',
      [teacher.id, classId, subjectId]
    );
    if (!assignment) {
      return res.status(403).json({ message: 'Unauthorized: You are not assigned to teach this subject in this class.' });
    }

    const result = await run(
      `INSERT INTO assessments (class_id, subject_id, teacher_id, title, type, max_marks, due_date, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [classId, subjectId, teacher.id, title.trim(), type || 'quiz', Number(maxMarks) || 100, dueDate || null]
    );

    return res.status(201).json({ message: 'Assessment created successfully.', assessmentId: result.id });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create assessment.' });
  }
});

/**
 * POST /api/teacher/grades
 * Enter or update student marks for an assessment.
 * Grades are held for Administrator review and approval before public release.
 */
router.post('/grades', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const { assessmentId, marks } = req.body; // marks: [ { studentId, marksObtained, remarks } ]

    if (!assessmentId || !Array.isArray(marks)) {
      return res.status(400).json({ message: 'Assessment ID and marks array are required.' });
    }

    const assess = await get('SELECT * FROM assessments WHERE id = ? AND teacher_id = ?', [assessmentId, teacher.id]);
    if (!assess) {
      return res.status(403).json({ message: 'Unauthorized: You are not the author of this assessment.' });
    }

    for (const m of marks) {
      const percentage = (Number(m.marksObtained) / Number(assess.max_marks)) * 100;
      let letter = 'F';
      if (percentage >= 80) letter = 'A';
      else if (percentage >= 70) letter = 'B';
      else if (percentage >= 60) letter = 'C';
      else if (percentage >= 50) letter = 'D';

      await run(
        `INSERT INTO grades (assessment_id, student_id, marks_obtained, grade_letter, remarks, is_approved_by_admin, is_published)
         VALUES (?, ?, ?, ?, ?, 0, 0)
         ON CONFLICT(assessment_id, student_id) DO UPDATE SET
           marks_obtained = excluded.marks_obtained,
           grade_letter = excluded.grade_letter,
           remarks = excluded.remarks,
           is_approved_by_admin = 0,
           is_published = 0`,
        [assessmentId, m.studentId, Number(m.marksObtained), letter, m.remarks || null]
      );
    }

    await recordAuditLog(req.user.id, 'SUBMIT_GRADES', 'grades', assessmentId, { count: marks.length });
    return res.json({ message: 'Marks recorded and submitted for administrator review.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to record grades: ' + err.message });
  }
});

/**
 * GET /api/teacher/timetables
 * Teacher's teaching schedule.
 */
router.get('/timetables', async (req, res) => {
  try {
    const teacher = await getTeacherRecord(req.user.id);
    const schedule = await all(
      `SELECT t.*, c.name AS class_name, s.name AS subject_name, s.code AS subject_code
       FROM timetables t
       JOIN classes c ON t.class_id = c.id
       JOIN subjects s ON t.subject_id = s.id
       WHERE t.teacher_id = ?
       ORDER BY CASE t.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 ELSE 6 END, t.start_time`,
      [teacher.id]
    );
    return res.json(schedule);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch timetable.' });
  }
});

/**
 * GET /api/teacher/announcements
 * View school notices for teachers.
 */
router.get('/announcements', async (req, res) => {
  try {
    const list = await all(`
      SELECT * FROM announcements
      WHERE target_role IN ('all', 'Teacher')
      ORDER BY created_at DESC
    `);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch announcements.' });
  }
});

export default router;
