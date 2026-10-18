export default async function handler(req, res) {
  try {
    // Dynamic import to catch any module load or sqlite3 native binary failure
    const { default: app } = await import('../src/server.js');
    const { setupDatabase } = await import('../src/setupDatabase.js');
    const { seedAcademicData } = await import('../src/seed.js');

    if (!global.__db_initialized) {
      try {
        await setupDatabase();
        await seedAcademicData();
        global.__db_initialized = true;
      } catch (dbErr) {
        console.warn('[DB Init Note]:', dbErr.message);
      }
    }

    return app(req, res);
  } catch (err) {
    console.error('[SERVERLESS ERROR]:', err);
    return res.status(500).json({
      error: 'Serverless Handler Initialization Error',
      message: err.message,
      stack: err.stack,
    });
  }
}
