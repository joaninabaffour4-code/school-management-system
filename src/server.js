import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDatabase } from './setupDatabase.js';
import { initBackupScheduler } from './utils/backup.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import parentRoutes from './routes/parentRoutes.js';
import accountantRoutes from './routes/accountantRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import { get } from './config/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public Health Check Endpoint for AWS Load Balancers, ECS, EC2, App Runner
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await get('SELECT 1 AS alive');
    return res.status(200).json({
      status: 'healthy',
      database: dbCheck && dbCheck.alive === 1 ? 'connected' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    return res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// HTML Page Route Handlers
const publicDir = path.join(__dirname, '..', 'public');

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/verify-email', (req, res) => res.sendFile(path.join(publicDir, 'verify-email.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(publicDir, 'forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(publicDir, 'reset-password.html')));

// Separate Administrator Authentication Page
app.get('/admin/login', (req, res) => res.sendFile(path.join(publicDir, 'admin-login.html')));

// Role Dashboard Pages
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'admin-dashboard.html')));
app.get('/teacher/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'teacher-dashboard.html')));
app.get('/student/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'student-dashboard.html')));
app.get('/parent/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'parent-dashboard.html')));

// Legacy Routes for backward compatibility
app.get('/admin', (req, res) => res.redirect('/admin/dashboard'));
app.get('/accountant', (req, res) => res.sendFile(path.join(publicDir, 'accountant.html')));
app.get('/customer', (req, res) => res.sendFile(path.join(publicDir, 'customer.html')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/accountant', accountantRoutes);
app.use('/api/customer', customerRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  return res.status(500).json({ message: 'Internal server error occurred.' });
});

async function startServer() {
  await setupDatabase();
  initBackupScheduler();

  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  School Management System running on http://localhost:${PORT}`);
    console.log(`  Health Check: http://localhost:${PORT}/health`);
    console.log(`  Admin Login:  http://localhost:${PORT}/admin/login`);
    console.log(`  User Login:   http://localhost:${PORT}/login`);
    console.log(`=======================================================`);
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

export default app;
