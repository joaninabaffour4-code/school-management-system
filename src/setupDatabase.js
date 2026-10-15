import { run, get, all } from './config/database.js';

export async function setupDatabase() {
  // 1. Roles table
  await run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  // Ensure all 4 school roles plus legacy roles exist
  const rolesToEnsure = [
    'Administrator',
    'Teacher',
    'Student',
    'Parent/Guardian',
    'admin',
    'accountant',
    'customer',
  ];

  for (const roleName of rolesToEnsure) {
    const existing = await get('SELECT * FROM roles WHERE name = ?', [roleName]);
    if (!existing) {
      await run('INSERT INTO roles (name) VALUES (?)', [roleName]);
    }
  }

  // 2. Users table
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      is_email_verified INTEGER DEFAULT 0,
      email_verification_token TEXT,
      email_verification_expires DATETIME,
      password_reset_token TEXT,
      password_reset_expires DATETIME,
      is_2fa_enabled INTEGER DEFAULT 0,
      totp_secret_encrypted TEXT,
      totp_secret_iv TEXT,
      totp_secret_tag TEXT,
      phone TEXT,
      security_question_1 TEXT,
      security_answer_1 TEXT,
      security_question_2 TEXT,
      security_answer_2 TEXT,
      is_security_check_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(role_id) REFERENCES roles(id)
    )
  `);

  // Non-destructive column migrations for users table
  const userColumns = await all(`PRAGMA table_info(users)`);
  const colNames = userColumns.map((c) => c.name);

  const columnsToAdd = [
    { name: 'username', def: 'TEXT UNIQUE' },
    { name: 'status', def: "TEXT DEFAULT 'active'" },
    { name: 'is_email_verified', def: 'INTEGER DEFAULT 0' },
    { name: 'email_verification_token', def: 'TEXT' },
    { name: 'email_verification_expires', def: 'DATETIME' },
    { name: 'password_reset_token', def: 'TEXT' },
    { name: 'password_reset_expires', def: 'DATETIME' },
    { name: 'is_2fa_enabled', def: 'INTEGER DEFAULT 0' },
    { name: 'totp_secret_encrypted', def: 'TEXT' },
    { name: 'totp_secret_iv', def: 'TEXT' },
    { name: 'totp_secret_tag', def: 'TEXT' },
    { name: 'phone', def: 'TEXT' },
  ];

  for (const col of columnsToAdd) {
    if (!colNames.includes(col.name)) {
      try {
        await run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
      } catch (err) {
        // Unique column cannot be added directly with UNIQUE constraint in older SQLite; add without UNIQUE then create index
        if (col.name === 'username') {
          await run(`ALTER TABLE users ADD COLUMN username TEXT`);
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
        } else {
          console.error(`Migration notice for users.${col.name}:`, err.message);
        }
      }
    }
  }

  // Populate usernames for any existing users without a username
  const usersWithoutUsername = await all(`SELECT id, email, first_name, last_name FROM users WHERE username IS NULL OR username = ''`);
  for (const u of usersWithoutUsername) {
    let generatedUsername = u.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!generatedUsername) generatedUsername = `user${u.id}`;

    // Verify uniqueness
    const exists = await get('SELECT id FROM users WHERE username = ? AND id != ?', [generatedUsername, u.id]);
    if (exists) {
      generatedUsername = `${generatedUsername}${u.id}`;
    }

    await run('UPDATE users SET username = ? WHERE id = ?', [generatedUsername, u.id]);
  }

  // 3. Academic Years & Terms
  await run(`
    CREATE TABLE IF NOT EXISTS academic_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_current INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_current INTEGER DEFAULT 0,
      FOREIGN KEY(academic_year_id) REFERENCES academic_years(id)
    )
  `);

  // 4. Classes & Subjects
  await run(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      grade_level TEXT NOT NULL,
      capacity INTEGER DEFAULT 35
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL
    )
  `);

  // 5. Teachers Profile
  await run(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      employee_id TEXT UNIQUE NOT NULL,
      qualification TEXT,
      department TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 6. Students Profile
  await run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      admission_number TEXT UNIQUE NOT NULL,
      date_of_birth DATE,
      gender TEXT,
      emergency_contact TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 7. Guardians Profile & Guardian-Student Relationship (Supports multiple children per parent!)
  await run(`
    CREATE TABLE IF NOT EXISTS guardians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      relationship_type TEXT DEFAULT 'Parent',
      emergency_phone TEXT,
      address TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS guardian_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guardian_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'Parent',
      is_primary INTEGER DEFAULT 1,
      UNIQUE(guardian_id, student_id),
      FOREIGN KEY(guardian_id) REFERENCES guardians(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // 8. Teacher-Subject Assignments
  await run(`
    CREATE TABLE IF NOT EXISTS teacher_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      UNIQUE(teacher_id, subject_id, class_id),
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    )
  `);

  // 9. Class Enrollments
  await run(`
    CREATE TABLE IF NOT EXISTS class_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      academic_year_id INTEGER NOT NULL,
      status TEXT DEFAULT 'enrolled',
      UNIQUE(student_id, class_id, academic_year_id),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
    )
  `);

  // 10. Timetables
  await run(`
    CREATE TABLE IF NOT EXISTS timetables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      room TEXT,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    )
  `);

  // 11. Attendance
  await run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      date DATE NOT NULL,
      status TEXT NOT NULL, -- 'present', 'absent', 'late', 'excused'
      recorded_by_teacher_id INTEGER NOT NULL,
      notes TEXT,
      UNIQUE(student_id, class_id, date),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(recorded_by_teacher_id) REFERENCES teachers(id)
    )
  `);

  // 12. Assessments & Grades
  await run(`
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'quiz', -- 'homework', 'quiz', 'midterm', 'final_exam'
      max_marks REAL NOT NULL DEFAULT 100,
      due_date DATE,
      is_published INTEGER DEFAULT 0,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      marks_obtained REAL NOT NULL,
      grade_letter TEXT,
      remarks TEXT,
      is_approved_by_admin INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 0,
      UNIQUE(assessment_id, student_id),
      FOREIGN KEY(assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // 13. School Announcements & Notifications
  await run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      target_role TEXT DEFAULT 'all', -- 'all', 'Teacher', 'Student', 'Parent/Guardian'
      created_by_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 14. Audit Logs
  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 15. Backup Execution Logs (for tracking AWS S3 backups)
  await run(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL, -- 'success', 'failed'
      size_bytes INTEGER,
      sha256_checksum TEXT,
      s3_etag TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Preserve existing legacy tables (orders, payments)
  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
}

export default setupDatabase;
