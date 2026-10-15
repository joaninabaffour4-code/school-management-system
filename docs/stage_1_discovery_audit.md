# Stage 1: Discovery & System Audit Report

## 1. Executive Summary

An exhaustive inspection of your computer and workspace was conducted to determine the actual state of the project before making any changes. 

### Key Findings
1. **Workspace Location**:
   - The active Antigravity workspace is [`c:\Users\USER\Desktop\School management system`](file:///c:/Users/USER/Desktop/School%20management%20system). This directory is currently empty.
   - The existing project codebase was located at [`c:\Users\USER\Desktop\bajona`](file:///c:/Users/USER/Desktop/bajona) (last active today, October 15, 2026), with an earlier prototype located at [`c:\Users\USER\Desktop\Bajoana's Closet`](file:///c:/Users/USER/Desktop/Bajoana%27s%20Closet).
2. **Current Project Identity**:
   - The existing project is titled **"Bajona's Closet Management System"**, built with Node.js (ES Modules), Express, and SQLite.
   - The persistent SQLite database is located at [`c:\Users\USER\Desktop\bajona\data\bajonas_closet.db`](file:///c:/Users/USER/Desktop/bajona/data/bajonas_closet.db).
3. **Data Records Preserved**:
   - The database contains 4 existing user accounts (`admin@bajonascloset.com`, `accountant@bajonascloset.com`, `customer@bajonascloset.com`, and `testuser123@example.com`).
   - The existing roles are `admin`, `accountant`, and `customer`.
4. **Tooling & Environment**:
   - **Node.js**: Installed at `C:\Users\USER\nodejs\node-v24.20.0-win-x64\node.exe` (v24.20.0).
   - **npm**: v11.19.0.
   - **Database engine**: SQLite 3 via `sqlite3` library. MySQL Server 8.0 is installed on disk but not currently running or used by the code.

---

## 2. Requirement-by-Requirement Implementation Matrix

| # | Master Requirement | Current Status in Existing Code | Technical Reality & Evidence |
|---|--------------------|--------------------------------|------------------------------|
| 1 | **User Identification** | **Partially Implemented** | System uses `email` as login identifier ([authRoutes.js](file:///c:/Users/USER/Desktop/bajona/src/routes/authRoutes.js#L63-L73)). Does not yet use a distinct `username` login attribute. |
| 2 | **User Authentication** | **Implemented & Tested** | Passwords hashed using `bcryptjs` with 12 rounds ([password.js](file:///c:/Users/USER/Desktop/bajona/src/utils/password.js#L8-L12)). JWT issued on login with 8-hour expiry ([auth.js](file:///c:/Users/USER/Desktop/bajona/src/utils/auth.js#L6-L16)). Route protection via `authenticate` middleware. |
| 3 | **Two-Factor Authentication (2FA)** | **Partially Implemented** | Currently uses 2 personal security questions ([authRoutes.js](file:///c:/Users/USER/Desktop/bajona/src/routes/authRoutes.js#L80-L91)). An earlier prototype in `Bajoana's Closet` had TOTP (`speakeasy` + `qrcode`), and `otplib`/`qrcode` are present in dependencies. TOTP must be unified and preserved. |
| 4 | **Role-Based Access Control (RBAC)** | **Partially Implemented** | Backend middleware `authorize(...allowedRoles)` enforces role checks ([authMiddleware.js](file:///c:/Users/USER/Desktop/bajona/src/middleware/authMiddleware.js#L34-L46)). However, roles are currently `admin`, `accountant`, `customer`. The required 4 school roles (`Administrator`, `Teacher`, `Student`, `Parent/Guardian`) must be migrated. |
| 5 | **Password Salt and Pepper** | **Implemented & Tested** | **Salt**: Auto-generated per user via `bcrypt.genSalt(12)` and stored within the modular crypt format hash. **Pepper**: Implemented via `PEPPER_KEY` in [password.js](file:///c:/Users/USER/Desktop/bajona/src/utils/password.js#L6-L12) concatenated to plaintext before hashing (`${password}${pepper}`). |
| 6 | **Cryptographic Technique** | **Partially Implemented** | Password hashing (bcrypt) + pepper. Authenticated symmetric encryption (e.g. AES-256-GCM) is not yet applied to sensitive stored attributes such as TOTP secrets. |
| 7 | **Automated AWS Backups** | **Not Implemented** | No backup script, S3 bucket integration, scheduled cron, or restore validation mechanism exists yet. |
| 8 | **Administrator Dashboard** | **Partially Implemented** | Basic user management (create, list, delete) exists for Closet roles ([adminRoutes.js](file:///c:/Users/USER/Desktop/bajona/src/routes/adminRoutes.js)). No academic administration (classes, teachers, academic years, audit logs). |
| 9 | **Teacher Dashboard** | **Not Implemented** | No teacher routes or views exist yet. |
| 10| **Student Dashboard** | **Not Implemented** | No student routes or views exist yet. |
| 11| **Parent/Guardian Dashboard** | **Not Implemented** | No parent/guardian routes or views exist yet. |
| 12| **Public / Guest Experience** | **Partially Implemented** | Public login and register forms exist ([index.html](file:///c:/Users/USER/Desktop/bajona/public/index.html)), but no formal landing experience. |
| 13| **Mandatory Email Verification**| **Not Implemented** | Accounts do not have verification tokens, verified status flags, or email verification flows. |
| 14| **Separate Admin Authentication**| **Not Implemented** | Admins currently log in through the same public form as customers on `/login`. No separate `/admin/login` or protected onboarding. |
| 15| **AWS Hosting & Deployment** | **Not Implemented** | Application runs solely on local machine (`localhost:3000`). No AWS infrastructure provisioned yet. |
| 16| **S3 Protected Backup Architecture**| **Not Implemented** | S3 backup script, bucket policies, and retention policies not yet established. |
| 17| **AWS Security & Secret Management**| **Not Implemented** | Secrets currently stored in local `.env`. AWS Secrets Manager / Parameter Store not configured. |
| 18| **Database Design & Migrations**| **Partially Implemented** | SQLite tables exist for `users`, `roles`, `orders`, `payments`. Academic tables (classes, students, teachers, guardians, subjects, attendance, marks, timetables, announcements) need to be migrated safely. |
| 19| **User Interface & Frontend** | **Partially Implemented** | HTML/CSS pages exist for Closet app (`index.html`, `admin.html`, `accountant.html`, `customer.html`). Needs transformation to modern, responsive School Management System portals. |
| 20| **Testing Suite** | **Not Implemented** | No automated unit or integration tests exist in the project. |

---

## 3. Existing Database & Security Analysis

### Current Schema ([setupDatabase.js](file:///c:/Users/USER/Desktop/bajona/src/setupDatabase.js))
- `roles`: `id`, `name`
- `users`: `id`, `email`, `password_hash`, `first_name`, `last_name`, `role_id`, `security_question_1`, `security_answer_1`, `security_question_2`, `security_answer_2`, `is_security_check_enabled`, `created_at`
- `orders`: `id`, `user_id`, `total_amount`, `status`, `created_at`
- `payments`: `id`, `order_id`, `user_id`, `amount`, `payment_method`, `payment_status`, `created_at`

### User Records Discovered in Database:
```json
[
  { "id": 1, "email": "admin@bajonascloset.com", "role": "admin", "first_name": "System", "last_name": "Admin" },
  { "id": 2, "email": "accountant@bajonascloset.com", "role": "accountant", "first_name": "Finance", "last_name": "Manager" },
  { "id": 3, "email": "customer@bajonascloset.com", "role": "customer", "first_name": "Sample", "last_name": "Customer" },
  { "id": 4, "email": "testuser123@example.com", "role": "customer", "first_name": "Test", "last_name": "User" }
]
```

### Password Hashing, Salt, and Pepper Verification
- In [password.js](file:///c:/Users/USER/Desktop/bajona/src/utils/password.js):
  ```javascript
  const pepper = process.env.PEPPER_KEY || 'default-dev-pepper';
  export const hashPassword = async (password) => {
    const saltedPassword = `${password}${pepper}`;
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(saltedPassword, salt);
  };
  ```
- **Security Assessment**:
  - The salt is generated uniquely per password hash with cost factor 12.
  - The pepper is prepended/appended on the server before invoking bcrypt. This ensures that even if an attacker obtains a full database dump of hashes and salts, they cannot crack passwords without also obtaining `PEPPER_KEY`.

---

## 4. Proposed Migration & Upgrade Path

To honor your requirement to **preserve working functionality, existing user records, data relationships, and security controls**, while setting up the School Management System inside [`School management system`](file:///c:/Users/USER/Desktop/School%20management%20system):

1. **Step 1 (Data Preservation & Setup in Target Workspace)**:
   - Copy the working base codebase and database file safely from `bajona` into [`School management system`](file:///c:/Users/USER/Desktop/School%20management%20system).
   - Create an immutable backup snapshot of `bajonas_closet.db` as `data/backup_original_bajonas_closet.db`.
2. **Step 2 (Schema Expansion without Data Loss)**:
   - Add new columns to `users`: `username` (unique, generated from first/last/email for existing accounts), `is_email_verified`, `email_verification_token`, `email_verification_expires`, `totp_secret`, `is_totp_enabled`, `phone`.
   - Update `roles` table: Add `Administrator`, `Teacher`, `Student`, `Parent/Guardian` while mapping existing `admin` to `Administrator`.
   - Add school entities:
     - `academic_years`, `terms`
     - `classes`, `subjects`, `teacher_subjects`
     - `students`, `teachers`, `guardians`, `guardian_students`
     - `class_enrollments`, `timetables`
     - `attendance`
     - `assessments`, `grades`
     - `announcements`, `audit_logs`
3. **Step 3 (Authentication & Security Upgrades)**:
   - Switch login identifier to `username` (with email fallback support).
   - Implement TOTP 2FA (QR code generation + code verification) and encrypt TOTP secrets using **AES-256-GCM** (satisfying Requirement 6 Cryptographic Technique).
   - Implement Mandatory Email Verification workflow with signed/expiring tokens.
   - Implement separate `/admin/login` and protected admin provisioning.
4. **Step 4 (Four Role Dashboards & School Operations)**:
   - Administrator, Teacher, Student, and Parent/Guardian portals with server-side RBAC and data isolation (e.g., parents can only see their linked children, teachers only their classes, students cannot edit grades).
5. **Step 5 (AWS Backup Automation & AWS Deployment)**:
   - Implement automated backup script that exports the SQLite database, encrypts the backup file, and uploads it to an AWS S3 bucket on a schedule.
   - Include test restore verification script.
   - Configure deployment architecture for AWS.
