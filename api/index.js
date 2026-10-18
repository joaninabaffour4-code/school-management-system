export default async function handler(req, res) {
  try {
    if (req.url === '/api/ping' || req.url === '/ping') {
      return res.status(200).json({
        status: 'pong',
        url: req.url,
        matchedPath: req.headers['x-matched-path'],
      });
    }

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

    // If request was rewritten from a subpath or root
    if (req.headers['x-matched-path'] && !req.url.startsWith('/api')) {
      req.url = req.headers['x-matched-path'];
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
