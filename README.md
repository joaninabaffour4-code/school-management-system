# Secure School Management System (Nina International)

A secure, enterprise-grade academic School Management System built with **Node.js**, **Express**, **SQLite**, and **AWS Cloud Services**. Originating from a secure authentication and authorization architecture, this system enforces four distinct school roles (**Administrator**, **Teacher**, **Student**, and **Parent/Guardian**), **RFC 6238 TOTP Two-Factor Authentication**, **AES-256-GCM Authenticated Symmetric Encryption**, **Bcrypt Salt + Secret Pepper Password Security**, and **Automated Encrypted Database Backups to Amazon S3 with Disaster Recovery Restoration Testing**.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/joaninabaffour4-code/school-management-system)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/joaninabaffour4-code/school-management-system)

---

## 🏛️ System Architecture & Highlights

- **User Identification**: Uses unique, normalized usernames for login while preserving email addresses for mandatory verification and account recovery.
- **Password Security**: Enforces 12-round `bcryptjs` hashing with automatic 16-byte cryptographically secure salts combined with a server-side `PEPPER_KEY`.
- **Cryptographic Technique**: AES-256-GCM authenticated symmetric encryption with 96-bit random IVs and 128-bit authentication tags to protect TOTP secrets and database backups at rest.
- **Two-Factor Authentication (2FA)**: RFC 6238 Time-based One-Time Passwords (TOTP) compatible with Google Authenticator and Microsoft Authenticator, enforced via pre-auth temporary tokens.
- **Role-Based Access Control (RBAC)**: Authoritative server-side middleware for:
  - **Administrator**: Dedicated gateway (`/admin/login`), user provisioning, academic term and grade approval, and AWS backup controls.
  - **Teacher**: Class attendance marking, assignment entry, and draft grade submission for assigned classes only.
  - **Student**: View timetables, attendance history, and published report cards.
  - **Parent / Guardian**: Multi-child portal to monitor grades and attendance with strict Anti-IDOR (Insecure Direct Object Reference) verification.
- **Automated AWS S3 Backups**: Daily automated cron backup pipeline (`0 2 * * *`) that compresses, SHA-256 digests, AES-256-GCM encrypts, and uploads database snapshots to a hardened, private AWS S3 bucket with a 30-day lifecycle retention policy.
- **Tested Disaster Recovery**: Isolated sandbox restoration utility (`data/test_restored.db`) verifying data integrity without touching production databases.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v24 LTS recommended)
- **npm**: v9.0.0 or higher

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/joaninabaffour4-code/school-management-system.git
cd school-management-system

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
```

### 3. Database Initialization & Seeding
```bash
# Seed default roles, classes, subjects, historical attendance, and users
npm run seed
```

### 4. Start the Application
```bash
npm start
```
The application will launch on `http://localhost:3000`.

- **Landing Portal**: [http://localhost:3000/](http://localhost:3000/)
- **Administrator Portal**: [http://localhost:3000/admin/login](http://localhost:3000/admin/login)
- **Faculty / Student / Parent Portal**: [http://localhost:3000/login](http://localhost:3000/login)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

---

## 🔑 Default Demonstration Accounts

| Role | Username | Password | Permitted Actions |
|---|---|---|---|
| **Administrator** | `admin` | `Admin@123` | Full administrative oversight, grade approval, role provisioning, AWS backups |
| **Teacher** | `teacher1` | `Password@123` | Grade 10A Mathematics & Science, attendance recording, assessment scoring |
| **Student 1** | `student1` | `Password@123` | View Grade 10A timetable, attendance statistics, published report card |
| **Student 2** | `student2` | `Password@123` | Sibling of Student 1; Grade 10A attendance and academic results |
| **Parent / Guardian** | `parent1` | `Password@123` | Multi-child dashboard linked to Student 1 & 2; Anti-IDOR protected |

---

## 🧪 Automated Testing Suite

The repository includes a comprehensive 28-test integration suite covering cryptography, password salting, rate limiting, RBAC, 2FA, anti-IDOR checks, and backup restoration.

```bash
npm test
```

Expected output:
```text
================================================================
  TEST RESULTS SUMMARY: 28 / 28 PASSED (0 FAILED)
================================================================
```

---

## ☁️ AWS Deployment & S3 Backups

### Run Automated Backup Now
```bash
npm run backup
```

### Run Isolated Restoration Integrity Test
```bash
npm run restore:test
```

### Cloud Deployment Runner
```bash
npm run deploy:aws
```

### Cloud Configuration (`.env`)
```env
AWS_REGION=us-east-1
AWS_S3_BACKUP_BUCKET=school-management-backups-2026
BACKUP_SCHEDULE_CRON=0 2 * * *
BACKUP_RETENTION_DAYS=30
```

---

## 📚 Academic Documentation

- [Viva Presentation & Defense Guide (30 Questions + Demo Script)](docs/viva_preparation_guide.md)
- [Comprehensive Academic Project Report](docs/final_comprehensive_report.md)
- [Stage 1 Discovery & Audit Log](docs/stage_1_discovery_audit.md)