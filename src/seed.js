import dotenv from 'dotenv';
import { run, get, all } from './config/database.js';
import { setupDatabase } from './setupDatabase.js';
import { hashPassword } from './utils/password.js';

dotenv.config();

export async function seedAcademicData() {
  await setupDatabase();
  console.log('Seeding School Management System initial records...');

  // 1. Roles
  const adminRole = await get("SELECT id FROM roles WHERE name = 'Administrator' OR name = 'admin'");
  const teacherRole = await get("SELECT id FROM roles WHERE name = 'Teacher'");
  const studentRole = await get("SELECT id FROM roles WHERE name = 'Student'");
  const parentRole = await get("SELECT id FROM roles WHERE name = 'Parent/Guardian'");

  // 2. Academic Year
  let year = await get("SELECT id FROM academic_years WHERE name = '2026/2027'");
  if (!year) {
    const res = await run(
      "INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES ('2026/2027', '2026-09-01', '2027-06-30', 1)"
    );
    year = { id: res.id };
  }

  // Terms
  let term1 = await get("SELECT id FROM terms WHERE name = 'Term 1' AND academic_year_id = ?", [year.id]);
  if (!term1) {
    const res = await run(
      "INSERT INTO terms (academic_year_id, name, start_date, end_date, is_current) VALUES (?, 'Term 1', '2026-09-01', '2026-12-15', 1)",
      [year.id]
    );
    term1 = { id: res.id };
  }

  // 3. Classes
  let class10A = await get("SELECT id FROM classes WHERE name = 'Grade 10A'");
  if (!class10A) {
    const res = await run("INSERT INTO classes (name, grade_level, capacity) VALUES ('Grade 10A', '10', 35)");
    class10A = { id: res.id };
  }

  let class11Sci = await get("SELECT id FROM classes WHERE name = 'Grade 11 Science'");
  if (!class11Sci) {
    const res = await run("INSERT INTO classes (name, grade_level, capacity) VALUES ('Grade 11 Science', '11', 30)");
    class11Sci = { id: res.id };
  }

  // 4. Subjects
  const subjectsToSeed = [
    { name: 'Mathematics', code: 'MTH101' },
    { name: 'Integrated Science', code: 'SCI101' },
    { name: 'English Language', code: 'ENG101' },
    { name: 'Information Technology', code: 'IT101' },
  ];

  const subjectMap = {};
  for (const s of subjectsToSeed) {
    let sub = await get('SELECT id FROM subjects WHERE code = ?', [s.code]);
    if (!sub) {
      const res = await run('INSERT INTO subjects (name, code) VALUES (?, ?)', [s.name, s.code]);
      sub = { id: res.id };
    }
    subjectMap[s.code] = sub.id;
  }

  // 5. Default Users for Each Role
  const defaultPassword = 'Password@123';
  const hashedDefaultPassword = await hashPassword(defaultPassword);

  const sampleUsers = [
    {
      username: 'teacher1',
      email: 'teacher1@school.edu',
      first_name: 'Kwesi',
      last_name: 'Appiah',
      role_id: teacherRole.id,
      phone: '+233241000001',
      employee_id: 'TCH-001',
      qualification: 'B.Ed Mathematics & Physics',
      department: 'Mathematics & Science',
    },
    {
      username: 'student1',
      email: 'student1@school.edu',
      first_name: 'Ama',
      last_name: 'Serwaa',
      role_id: studentRole.id,
      phone: '+233241000002',
      admission_number: 'STU-2026-001',
      dob: '2010-04-12',
      gender: 'Female',
    },
    {
      username: 'student2',
      email: 'student2@school.edu',
      first_name: 'Kofi',
      last_name: 'Mensah',
      role_id: studentRole.id,
      phone: '+233241000003',
      admission_number: 'STU-2026-002',
      dob: '2010-09-25',
      gender: 'Male',
    },
    {
      username: 'parent1',
      email: 'parent1@school.edu',
      first_name: 'Akosua',
      last_name: 'Mensah',
      role_id: parentRole.id,
      phone: '+233241000004',
      relationship_type: 'Mother',
      address: 'Plot 14 Airport Residential, Accra',
    },
  ];

  for (const u of sampleUsers) {
    let user = await get('SELECT id FROM users WHERE username = ? OR email = ?', [u.username, u.email]);
    if (!user) {
      const res = await run(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, role_id, phone, is_email_verified, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        [u.username, u.email, hashedDefaultPassword, u.first_name, u.last_name, u.role_id, u.phone]
      );
      user = { id: res.id };
    } else {
      // Ensure email verified and active for testing
      await run("UPDATE users SET is_email_verified = 1, status = 'active' WHERE id = ?", [user.id]);
    }

    // Role-specific records
    if (u.employee_id) {
      const tch = await get('SELECT id FROM teachers WHERE user_id = ?', [user.id]);
      if (!tch) {
        await run('INSERT INTO teachers (user_id, employee_id, qualification, department) VALUES (?, ?, ?, ?)', [
          user.id,
          u.employee_id,
          u.qualification,
          u.department,
        ]);
      }
    }

    if (u.admission_number) {
      const stu = await get('SELECT id FROM students WHERE user_id = ?', [user.id]);
      if (!stu) {
        await run('INSERT INTO students (user_id, admission_number, date_of_birth, gender) VALUES (?, ?, ?, ?)', [
          user.id,
          u.admission_number,
          u.dob,
          u.gender,
        ]);
      }
    }

    if (u.relationship_type) {
      const grd = await get('SELECT id FROM guardians WHERE user_id = ?', [user.id]);
      if (!grd) {
        await run('INSERT INTO guardians (user_id, relationship_type, emergency_phone, address) VALUES (?, ?, ?, ?)', [
          user.id,
          u.relationship_type,
          u.phone,
          u.address,
        ]);
      }
    }
  }

  // Ensure Admin user (id 1) is verified and has Administrator role
  const existingAdmin = await get('SELECT id, role_id FROM users WHERE username = ? OR id = 1', ['admin']);
  if (existingAdmin) {
    await run(
      "UPDATE users SET role_id = ?, is_email_verified = 1, status = 'active' WHERE id = ?",
      [adminRole.id, existingAdmin.id]
    );
  }

  // 6. Link Teacher to Classes and Subjects
  const teacherRec = await get("SELECT t.id FROM teachers t JOIN users u ON t.user_id = u.id WHERE u.username = 'teacher1'");
  if (teacherRec) {
    const existingAssign1 = await get(
      'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ? AND class_id = ?',
      [teacherRec.id, subjectMap['MTH101'], class10A.id]
    );
    if (!existingAssign1) {
      await run('INSERT INTO teacher_subjects (teacher_id, subject_id, class_id) VALUES (?, ?, ?)', [
        teacherRec.id,
        subjectMap['MTH101'],
        class10A.id,
      ]);
    }

    const existingAssign2 = await get(
      'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ? AND class_id = ?',
      [teacherRec.id, subjectMap['SCI101'], class10A.id]
    );
    if (!existingAssign2) {
      await run('INSERT INTO teacher_subjects (teacher_id, subject_id, class_id) VALUES (?, ?, ?)', [
        teacherRec.id,
        subjectMap['SCI101'],
        class10A.id,
      ]);
    }
  }

  // 7. Enroll Students in Class 10A
  const stu1Rec = await get("SELECT s.id FROM students s JOIN users u ON s.user_id = u.id WHERE u.username = 'student1'");
  const stu2Rec = await get("SELECT s.id FROM students s JOIN users u ON s.user_id = u.id WHERE u.username = 'student2'");

  if (stu1Rec) {
    const enr1 = await get('SELECT id FROM class_enrollments WHERE student_id = ? AND class_id = ?', [stu1Rec.id, class10A.id]);
    if (!enr1) {
      await run('INSERT INTO class_enrollments (student_id, class_id, academic_year_id) VALUES (?, ?, ?)', [
        stu1Rec.id,
        class10A.id,
        year.id,
      ]);
    }
  }

  if (stu2Rec) {
    const enr2 = await get('SELECT id FROM class_enrollments WHERE student_id = ? AND class_id = ?', [stu2Rec.id, class10A.id]);
    if (!enr2) {
      await run('INSERT INTO class_enrollments (student_id, class_id, academic_year_id) VALUES (?, ?, ?)', [
        stu2Rec.id,
        class10A.id,
        year.id,
      ]);
    }
  }

  // 8. Link Parent to BOTH Students (Demonstrates Multi-Child Guardian Feature)
  const parentRec = await get("SELECT g.id FROM guardians g JOIN users u ON g.user_id = u.id WHERE u.username = 'parent1'");
  if (parentRec && stu1Rec) {
    const link1 = await get('SELECT id FROM guardian_students WHERE guardian_id = ? AND student_id = ?', [parentRec.id, stu1Rec.id]);
    if (!link1) {
      await run('INSERT INTO guardian_students (guardian_id, student_id, relationship) VALUES (?, ?, ?)', [
        parentRec.id,
        stu1Rec.id,
        'Mother',
      ]);
    }
  }
  if (parentRec && stu2Rec) {
    const link2 = await get('SELECT id FROM guardian_students WHERE guardian_id = ? AND student_id = ?', [parentRec.id, stu2Rec.id]);
    if (!link2) {
      await run('INSERT INTO guardian_students (guardian_id, student_id, relationship) VALUES (?, ?, ?)', [
        parentRec.id,
        stu2Rec.id,
        'Mother',
      ]);
    }
  }

  // 9. Timetable
  if (teacherRec) {
    const time1 = await get('SELECT id FROM timetables WHERE class_id = ? AND day_of_week = ? AND start_time = ?', [
      class10A.id,
      'Monday',
      '08:30',
    ]);
    if (!time1) {
      await run(
        'INSERT INTO timetables (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [class10A.id, subjectMap['MTH101'], teacherRec.id, 'Monday', '08:30', '09:30', 'Room 101']
      );
    }
    const time2 = await get('SELECT id FROM timetables WHERE class_id = ? AND day_of_week = ? AND start_time = ?', [
      class10A.id,
      'Monday',
      '09:30',
    ]);
    if (!time2) {
      await run(
        'INSERT INTO timetables (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [class10A.id, subjectMap['SCI101'], teacherRec.id, 'Monday', '09:30', '10:30', 'Lab 2']
      );
    }
  }

  // 10. Assessments & Grades
  if (teacherRec) {
    let assess = await get("SELECT id FROM assessments WHERE title = 'Midterm Mathematics Examination' AND class_id = ?", [
      class10A.id,
    ]);
    if (!assess) {
      const res = await run(
        `INSERT INTO assessments (class_id, subject_id, teacher_id, title, type, max_marks, due_date, is_published)
         VALUES (?, ?, ?, 'Midterm Mathematics Examination', 'midterm', 100, '2026-10-20', 1)`,
        [class10A.id, subjectMap['MTH101'], teacherRec.id]
      );
      assess = { id: res.id };
    }

    if (stu1Rec) {
      const grade1 = await get('SELECT id FROM grades WHERE assessment_id = ? AND student_id = ?', [assess.id, stu1Rec.id]);
      if (!grade1) {
        await run(
          `INSERT INTO grades (assessment_id, student_id, marks_obtained, grade_letter, remarks, is_approved_by_admin, is_published)
           VALUES (?, ?, 92.5, 'A', 'Outstanding performance in algebra and geometry', 1, 1)`,
          [assess.id, stu1Rec.id]
        );
      }
    }

    if (stu2Rec) {
      const grade2 = await get('SELECT id FROM grades WHERE assessment_id = ? AND student_id = ?', [assess.id, stu2Rec.id]);
      if (!grade2) {
        await run(
          `INSERT INTO grades (assessment_id, student_id, marks_obtained, grade_letter, remarks, is_approved_by_admin, is_published)
           VALUES (?, ?, 78.0, 'B', 'Very good understanding of fundamental theorems', 1, 1)`,
          [assess.id, stu2Rec.id]
        );
      }
    }
  }

  // 11. Announcements
  const adminUser = await get("SELECT id FROM users WHERE username = 'admin' OR id = 1");
  const adminId = adminUser ? adminUser.id : 1;

  const ann1 = await get("SELECT id FROM announcements WHERE title = 'Welcome to Academic Year 2026/2027'");
  if (!ann1) {
    await run(
      `INSERT INTO announcements (title, content, target_role, created_by_user_id)
       VALUES ('Welcome to Academic Year 2026/2027', 'Welcome back all students, teachers, and parents. Classes commence Monday at 08:00 AM.', 'all', ?)`,
      [adminId]
    );
  }

  const ann2 = await get("SELECT id FROM announcements WHERE title = 'Midterm Assessment Schedule'");
  if (!ann2) {
    await run(
      `INSERT INTO announcements (title, content, target_role, created_by_user_id)
       VALUES ('Midterm Assessment Schedule', 'Midterm examination timetables have been published. Please review your portal schedule.', 'Student', ?)`,
      [adminId]
    );
  }

  // 12. Historical Daily Attendance Records (for Student & Parent Portal statistics)
  if (teacherRec && class10A) {
    const sampleDates = [
      { date: '2026-10-01', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-02', stu1: 'present', stu2: 'present', note1: 'Active participation', note2: 'On time' },
      { date: '2026-10-05', stu1: 'present', stu2: 'late', note1: 'On time', note2: 'Traffic delay (10 mins)' },
      { date: '2026-10-06', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-07', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-08', stu1: 'excused', stu2: 'present', note1: 'Approved medical appointment', note2: 'On time' },
      { date: '2026-10-09', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-12', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-13', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
      { date: '2026-10-14', stu1: 'present', stu2: 'absent', note1: 'On time', note2: 'Unexcused absence' },
      { date: '2026-10-15', stu1: 'present', stu2: 'present', note1: 'On time', note2: 'On time' },
    ];

    for (const d of sampleDates) {
      if (stu1Rec) {
        await run(
          `INSERT INTO attendance (student_id, class_id, date, status, recorded_by_teacher_id, notes)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, class_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes`,
          [stu1Rec.id, class10A.id, d.date, d.stu1, teacherRec.id, d.note1]
        );
      }
      if (stu2Rec) {
        await run(
          `INSERT INTO attendance (student_id, class_id, date, status, recorded_by_teacher_id, notes)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, class_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes`,
          [stu2Rec.id, class10A.id, d.date, d.stu2, teacherRec.id, d.note2]
        );
      }
    }
  }

  console.log('Seeding completed successfully!');
}

seedAcademicData().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
