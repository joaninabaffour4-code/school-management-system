# Lecturer Presentation & Viva Defense Preparation Guide

This guide is tailored specifically to the **School Management System** codebase implemented on your machine. Every answer reflects your exact source code, database tables, and AWS configurations.

---

## Part 1: Core Security Concepts

### 1. User Identification
* **Short Answer**: "The system identifies accounts using a unique username rather than requiring an email for login, with server-side normalization and duplicate checks."
* **Everyday Language**: Just like logging into Instagram or Twitter with a handle, you use a unique username to declare who you are, while your email is kept strictly for account verification and recovery.
* **Deep Technical**: During login and registration, inputs are sanitized and normalized (`username.trim().toLowerCase()`). Identification queries the database (`SELECT * FROM users WHERE username = ? OR email = ?`) with parameterized statements to prevent SQL injection.
* **Code Proof**: [`authRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/authRoutes.js#L14) `normalizeUsername()` and line 125.
* **Live Demo**: Open `/login`, type `teacher1`, and demonstrate successful identification.
* **Likely Follow-up**: *"Why not just use email as the username?"* -> Using a separate username prevents account enumeration attacks where public email addresses expose account existence, and satisfies enterprise school conventions.
* **Honest Limitation**: Currently allows alphanumeric characters and underscores between 3 and 30 characters.

---

### 2. Password Authentication
* **Short Answer**: "Authentication verifies credentials by hashing the submitted password with bcrypt (cost factor 12) concatenated with a secret pepper and comparing it against the stored hash."
* **Everyday Language**: We never save your real password. We turn it into a one-way mathematical fingerprint with a secret ingredient. When you log in, we repeat the math and see if the fingerprints match.
* **Deep Technical**: Uses `bcrypt.compare(password + pepper, storedHash)`. The comparison is constant-time to resist timing side-channel attacks.
* **Code Proof**: [`password.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/password.js#L23) `verifyPassword()`.
* **Live Demo**: Submit an invalid password on `/login`; show timing-safe rejection and rate-limit counter decrement.
* **Likely Follow-up**: *"How do you prevent brute-force dictionary attacks?"* -> An in-memory rate limiter locks requests after 5 consecutive failed attempts per account/IP for 15 minutes.
* **Honest Limitation**: In multi-instance clustering without Redis, rate-limiting is per-process.

---

### 3. Password Salt and Pepper
* **Short Answer**: "The salt is a unique, random string generated per user and stored inside the bcrypt hash; the pepper is a global secret stored in the server environment, never stored in the database."
* **Everyday Language**: The salt is like giving every student a different locker padlock; identical passwords get completely different hashes. The pepper is the master key kept in the principal's safe—if someone steals the padlocks, they still cannot open them without the pepper.
* **Deep Technical**: `bcrypt.genSalt(12)` produces a 128-bit salt encoded into the Modular Crypt Format string (`$2a$12$...`). The pepper (`PEPPER_KEY`) is appended to plaintext before hashing. If the database is compromised via SQL injection, hashes cannot be cracked with rainbow tables without the external pepper.
* **Code Proof**: [`password.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/password.js#L8-L19).
* **Live Demo**: Run `npm test` and point out the test: `Bcrypt Unique Salts (Identical passwords produce distinct hashes)`.
* **Likely Follow-up**: *"What happens if the pepper is lost?"* -> All existing password hashes become un-verifiable; a formal recovery/pepper rotation workflow or password reset campaign is required.
* **Honest Limitation**: The pepper is currently loaded from server environment variables; in AWS production, it should be retrieved dynamically from AWS Secrets Manager.

---

### 4. Password Hashing versus Encryption
* **Short Answer**: "Hashing is a one-way irreversible transformation; encryption is a two-way reversible transformation requiring a secret decryption key."
* **Everyday Language**: Hashing is like baking a cake—you can't unbake it to get the raw eggs back. Encryption is like putting jewelry in a safe—you can unlock it and get the jewelry back whenever you have the key.
* **Deep Technical**: Password verification only requires checking hash equivalence, never retrieving plaintext. In contrast, sensitive data like TOTP secrets must be reversed to plain Base32 by the server to compute the RFC 6238 TOTP window, so they must use authenticated symmetric encryption, not hashing.
* **Code Proof**: Compare [`password.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/password.js) (one-way `bcrypt.hash`) with [`crypto.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/crypto.js) (two-way `createCipheriv` / `createDecipheriv`).
* **Live Demo**: Inspect SQLite database: show that `password_hash` starts with `$2a$` (hash) while `totp_secret_encrypted` has IV, tag, and ciphertext.
* **Likely Follow-up**: *"Why shouldn't you encrypt passwords instead of hashing them?"* -> If an attacker steals the encryption key, every user's plaintext password is exposed across all other accounts they own online.

---

### 5. Cryptographic Technique: Authenticated AES-256-GCM
* **Short Answer**: "We implement AES-256 in Galois/Counter Mode (GCM), providing both confidentiality and cryptographic integrity verification via a 16-byte authentication tag."
* **Everyday Language**: It encrypts the secret and seals it with a tamper-proof digital wax seal. If even a single character is tampered with in the database, the seal breaks and the system refuses to decrypt.
* **Deep Technical**: Every call generates a unique 12-byte (96-bit) IV using `crypto.randomBytes(12)`. The cipher computes a 128-bit authentication tag (`cipher.getAuthTag()`). Decryption enforces `decipher.setAuthTag(tag)` and throws an error if ciphertext or tag was altered.
* **Code Proof**: [`crypto.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/crypto.js#L26-L65).
* **Live Demo**: Point to the passing test in `tests/runTests.js`: `AES-256-GCM Tamper Detection (Integrity Rejection)`.
* **Likely Follow-up**: *"Why use a 12-byte IV instead of 16-byte?"* -> NIST SP 800-38D recommends 96-bit (12-byte) IVs for AES-GCM because it avoids additional GHASH operations during initialization.

---

### 6. Two-Factor Authentication (TOTP 2FA)
* **Short Answer**: "TOTP (Time-based One-Time Password, RFC 6238) generates 6-digit codes synchronized via timestamps; the shared secret is stored encrypted with AES-256-GCM."
* **Everyday Language**: When you log in, you prove something you know (password) plus something you have (your smartphone authenticator app generating changing 30-second codes).
* **Deep Technical**: Uses `otplib.authenticator` with a window of $\pm 1$ step (30-second clock skew tolerance). During enrollment, a QR code is generated using `qrcode`. The Base32 secret is encrypted before database insertion. On login, if `is_2fa_enabled = 1`, a 5-minute temporary token is issued (`createTemp2faToken`) until `/api/auth/2fa/verify` succeeds.
* **Code Proof**: [`totp.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/totp.js#L18-L50) and [`authRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/authRoutes.js#L305-L365).
* **Live Demo**: Open `/student/dashboard` or `/admin/dashboard`, click "Security & 2FA", scan QR code, and verify a 6-digit code.
* **Likely Follow-up**: *"Can a user access the dashboard with just the first factor if 2FA is enabled?"* -> No, the backend `authenticate` middleware rejects any token containing `twoFactorPending: true`.

---

### 7. Mandatory Email Verification
* **Short Answer**: "Every registered account must redeem a single-use, 24-hour cryptographic token sent via email before the backend permits access to school resources."
* **Everyday Language**: You cannot use your school account until you prove you actually own the email address you registered with.
* **Deep Technical**: Generates a 32-byte cryptographically secure random token (`crypto.randomBytes(32).toString('hex')`). The token is stored with `email_verification_expires`. The `requireEmailVerified` middleware blocks unverified accounts with HTTP 403.
* **Code Proof**: [`email.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/email.js#L26) and [`authMiddleware.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/middleware/authMiddleware.js#L46-L61).
* **Live Demo**: Register a student on `/register`; attempt to log in immediately and show the 403 Email Verification Required warning. Then click the verification link and show immediate login success.
* **Likely Follow-up**: *"How do you prevent email flooding?"* -> Resend verification endpoint enforces a 3-minute rate limit window per email address.

---

### 8. Role-Based Access Control (RBAC) & Server-Side Enforcement
* **Short Answer**: "RBAC restricts access based on verified role claims in authenticated tokens; all checks are authoritative on the server, never relying on UI visibility."
* **Everyday Language**: Hiding a 'Delete' button in HTML doesn't make an app secure. The server verifies your role and database permissions on every single request.
* **Deep Technical**: Middleware `authorize('Administrator', 'Teacher')` inspects `req.user.role`. Attempting to access unauthorized endpoints yields HTTP 403 Forbidden.
* **Code Proof**: [`authMiddleware.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/middleware/authMiddleware.js#L67-L95).
* **Live Demo**: Show test results where Student, Teacher, and Parent tokens are rejected from `/api/admin/stats` with 403.
* **Likely Follow-up**: *"What if a user modifies their role in local storage?"* -> The role is signed inside the server's HMAC-SHA256 JWT using `JWT_SECRET`; tampering with local storage invalidates the token signature.

---

### 9. Separate Administrator Authentication Interface
* **Short Answer**: "Administrators access a dedicated `/admin/login` interface with distinct visual styling, dedicated endpoint `/api/auth/admin/login`, and protected admin provisioning."
* **Everyday Language**: Normal users enter through the main school lobby; administrators enter through a fortified security control booth that normal student credentials cannot unlock.
* **Deep Technical**: `/api/auth/admin/login` verifies that `role === 'Administrator'`. New administrator provisioning (`/api/auth/admin/provision`) requires either an existing Administrator session or the environment bootstrap secret `ADMIN_SETUP_SECRET`.
* **Code Proof**: [`admin-login.html`](file:///c:/Users/USER/Desktop/School%20management%20system/public/admin-login.html) and [`authRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/authRoutes.js#L198-L260).
* **Live Demo**: Try logging into `/admin/login` with `student1` credentials; show HTTP 401 rejection. Then log in with `admin`.
* **Likely Follow-up**: *"Why separate admin authentication?"* -> It reduces attack surface, allows independent IP whitelisting or WAF rules, and prevents privilege escalation via public registration.

---

### 10. Anti-IDOR Protections (Parent-Student Link Verification)
* **Short Answer**: "Insecure Direct Object Reference (IDOR) is prevented by strictly validating database relationship records (`guardian_students`) rather than trusting user-supplied IDs."
* **Everyday Language**: If a parent changes the student ID in the URL from 1 to 2, the server checks if that student is actually their child. If not, access is blocked.
* **Deep Technical**: In `verifyLinkedStudent` middleware: `SELECT id FROM guardian_students WHERE guardian_id = ? AND student_id = ?`. If no row exists, returns HTTP 403 Forbidden.
* **Code Proof**: [`parentRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/parentRoutes.js#L16-L40).
* **Live Demo**: Show passing test: `Parent Prevented from Accessing Unrelated Student Records (403 Forbidden)`.
* **Likely Follow-up**: *"How does the system support parents with multiple children?"* -> `guardian_students` is a normalized many-to-many junction table; `GET /api/parent/children` returns all linked children.

---

## Part 2: Academic School Management Operations

### 11. The Responsibilities of Each Role
* **Administrator**: Full school management: user provisioning, role assignments, class creation, grade approval & publication, audit monitoring, AWS backups.
* **Teacher**: Classroom management: recording attendance for assigned classes, creating assessments, entering student marks (draft status).
* **Student**: Academic tracking: viewing published marks/grades, personal attendance records, course timetables, school notices.
* **Parent/Guardian**: Child monitoring: viewing linked children's published grades, attendance percentage, and class schedules.

---

### 12. Grade Approval & Publication Workflow
* **Short Answer**: "Faculty enter grades in draft state (`is_approved_by_admin = 0`); grades become visible to students and parents only after administrator approval (`is_published = 1`)."
* **Everyday Language**: Teachers grade the exams, but official report cards are reviewed and published by the administration office before students can see them.
* **Deep Technical**: In [`teacherRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/teacherRoutes.js#L180-L200), inserts hardcode `is_approved_by_admin = 0`. In [`adminRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/adminRoutes.js#L265), the admin approves via `PATCH /api/admin/grades/publish`. In [`studentRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/studentRoutes.js#L125), queries enforce `WHERE is_approved_by_admin = 1 AND is_published = 1`.
* **Code Proof**: Compare SQL in `teacherRoutes.js`, `adminRoutes.js`, and `studentRoutes.js`.
* **Live Demo**: In teacher dashboard, enter a mark for a student; switch to student dashboard to confirm it is not visible. Then log into admin dashboard, click "Approve & Publish", and show the grade now appears on the student report card!

---

### 13. Attendance Tracking & Integrity
* **Short Answer**: "Teachers record daily attendance (present, absent, late, excused) for their assigned classes with automatic uniqueness enforcement per student-class-date."
* **Deep Technical**: The `attendance` table enforces `UNIQUE(student_id, class_id, date)`. Updates use `ON CONFLICT(...) DO UPDATE` to allow editing attendance without duplicate rows.
* **Code Proof**: [`setupDatabase.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/setupDatabase.js#L180-L195) and [`teacherRoutes.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/routes/teacherRoutes.js#L85-L125).

---

### 14. Audit Logging & Non-Repudiation
* **Short Answer**: "Every sensitive security and administrative action is recorded in the `audit_logs` table with user ID, action type, resource ID, details, and timestamp."
* **Code Proof**: [`authMiddleware.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/middleware/authMiddleware.js#L100-L115) `recordAuditLog()`.
* **Live Demo**: Open `/admin/dashboard`, click "System Audit Logs", and show the chronological event log.

---

## Part 3: AWS Architecture & Automated Backups

### 15. AWS Hosting Architecture
* **Short Answer**: "The application is deployed on an Amazon EC2 instance (or AWS App Runner container) reverse-proxied by Nginx with TLS termination, connecting to the secure application database."
* **Everyday Language**: An Amazon cloud server runs our Node.js application. Nginx serves as a security guard at the front gate, managing HTTPS encryption and routing requests safely to Node.
* **Deep Technical**: The architecture utilizes an EC2 t3.small instance running Ubuntu 24.04 LTS. Systemd manages process execution and automatic restart (`school-system.service`). Nginx handles TLS 1.3 encryption, static file caching, and reverse-proxies API requests to `http://127.0.0.1:3000`.
* **Code Proof**: [`deploy_ec2.sh`](file:///c:/Users/USER/Desktop/School%20management%20system/aws/deploy_ec2.sh) and [`Dockerfile`](file:///c:/Users/USER/Desktop/School%20management%20system/Dockerfile).

---

### 16. Automated AWS S3 Backup Process
* **Short Answer**: "A background cron job runs daily at 02:00 UTC, copies the live SQLite database, encrypts it with AES-256-GCM, verifies SHA-256, and uploads it to a private S3 bucket via `@aws-sdk/client-s3`."
* **Deep Technical Steps**:
  1. Cron triggers `runDatabaseBackup()`.
  2. Database file is read into memory safely.
  3. SHA-256 hash computed for integrity verification.
  4. Encrypted with AES-256-GCM using unique IV and 128-bit auth tag.
  5. S3 `PutObjectCommand` transfers file with `ServerSideEncryption: 'AES256'`.
  6. Record inserted into `backup_logs` table.
  7. Retention policy prunes backups older than 30 days.
* **Code Proof**: [`backup.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/backup.js#L45-L135).
* **Live Demo**: Open Admin Dashboard -> AWS S3 Backups -> Click "Trigger Immediate AWS Backup", watch the new entry appear in the table with SHA-256 hash.

---

### 17. S3 Bucket Security & Protection
* **Short Answer**: "The backup S3 bucket is secured by S3 Block Public Access, AWS default server-side encryption (SSE-S3), bucket versioning, and least-privilege IAM policies."
* **Deep Technical**: The IAM policy restricts permissions strictly to `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, and `s3:DeleteObject` solely on the backup bucket ARN. Public ACLs and public policies are denied unconditionally.
* **Code Proof**: [`iam_policy_s3_backup.json`](file:///c:/Users/USER/Desktop/School%20management%20system/aws/iam_policy_s3_backup.json) and [`setup_aws_s3.sh`](file:///c:/Users/USER/Desktop/School%20management%20system/aws/setup_aws_s3.sh).

---

### 18. Disaster Recovery & Tested Isolated Restoration
* **Short Answer**: "A backup is merely a hypothesis until tested. Our restore utility downloads and decrypts the backup into an isolated sandbox (`data/test_restored.db`) without touching the live database."
* **Deep Technical**: `verifyRestoreTest()` loads the encrypted backup, extracts the IV and auth tag, decrypts via AES-256-GCM, recomputes SHA-256 to ensure zero corruption, writes to `test_restored.db`, and queries table and user counts.
* **Code Proof**: [`restore.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/utils/restore.js#L20-L85).
* **Live Demo**: Run `npm run restore:test` in terminal and show the exact SHA-256 match and table count verification report.

---

### 19. Secret Management & Cloud Security
* **Short Answer**: "Production secrets (pepper, AES encryption key, JWT secret, AWS keys) are kept out of source code and git via `.gitignore`, configured via environment variables and IAM roles."
* **Code Proof**: [`.gitignore`](file:///c:/Users/USER/Desktop/School%20management%20system/.gitignore) and [`.env.example`](file:///c:/Users/USER/Desktop/School%20management%20system/.env.example).

---

### 20. System Health Monitoring
* **Short Answer**: "An unauthenticated health check endpoint `/health` provides real-time system status, uptime, and database connectivity for AWS load balancers and CloudWatch."
* **Code Proof**: [`server.js`](file:///c:/Users/USER/Desktop/School%20management%20system/src/server.js#L30-L45).
* **Live Demo**: Visit `http://localhost:3000/health` in browser; show `{ status: "healthy", database: "connected" }`.

---

## Part 4: Practical Demonstration Script for Your Lecturer

Follow these steps in order when presenting to your lecturer:

| Step | Action | What to Explain to Lecturer |
|---|---|---|
| **1** | Open terminal and run `npm test` | *"All 28 automated tests pass 100%, covering cryptographic tamper detection, bcrypt salting, username authentication, rate limiting, RBAC role isolation, email verification, and AWS restore integrity."* |
| **2** | Open browser to `http://localhost:3000/` | *"This is our school landing page. Notice that the Administration portal is separated into a dedicated secure gateway."* |
| **3** | Click **Admin Portal** (`/admin/login`) | *"This is the dedicated Administrator gateway with distinct dark security styling. Public registration cannot create administrators."* |
| **4** | Log in as `admin` (`Admin@123`) | *"The admin dashboard provides real-time statistics calculated from the SQLite database: users, teachers, students, classes, and AWS backup history."* |
| **5** | Click **AWS S3 Backups** -> **Trigger Immediate AWS Backup** | *"This executes our backup script: copies the database, computes a SHA-256 checksum, encrypts with AES-256-GCM, and dispatches to AWS S3 with automated 30-day retention."* |
| **6** | Open a new private window, log in as `teacher1` (`Password@123`) | *"This is the Teacher portal. The teacher can view only their assigned classes (Grade 10A Mathematics & Science). They can record daily attendance and enter student assessment marks."* |
| **7** | Submit a mark as `teacher1` | *"Notice that the grade is saved in draft state. The teacher cannot publish grades directly to report cards."* |
| **8** | Return to `admin` dashboard -> **Review & Publish Marks** | *"The administrator reviews faculty marks and clicks 'Approve & Publish All Grades'. This enforces academic oversight."* |
| **9** | Log in as `student1` (`Password@123`) | *"The student sees their published report card with Grade A and instructor remarks. They cannot edit grades or view other students' records."* |
| **10** | Log in as `parent1` (`Password@123`) | *"The parent dashboard features a multi-child switcher linked to both `student1` and `student2`. Even if a user tampers with the student ID in an API request, our backend `verifyLinkedStudent` middleware blocks IDOR attacks."* |
| **11** | Open terminal and run `npm run restore:test` | *"This proves disaster recovery: it decrypts the latest backup, verifies the SHA-256 hash, and tests restoration in an isolated sandbox without risking live production data."* |
| **12** | Open terminal and run `npm run deploy:aws` | *"This executes our automated AWS deployment runner. It tests AWS connectivity, provisions/hardens the S3 bucket with Block Public Access and SSE-AES256, executes the backup pipeline, and validates end-to-end cloud recovery."* |
