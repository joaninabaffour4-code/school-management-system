import app from '../src/server.js';
import setupDatabase from '../src/setupDatabase.js';
import { seedAcademicData } from '../src/seed.js';

let initialized = false;

export default async function handler(req, res) {
  if (!initialized) {
    try {
      await setupDatabase();
      await seedAcademicData();
      initialized = true;
    } catch (err) {
      console.warn('[SERVERLESS INIT NOTE]:', err.message);
    }
  }
  return app(req, res);
}
