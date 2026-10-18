export default async function handler(req, res) {
  try {
    if (req.url.startsWith('/api/ping') || req.url === '/ping') {
      return res.status(200).json({
        status: 'pong',
        url: req.url,
        argv: process.argv,
        envVercel: process.env.VERCEL,
      });
    }

    if (req.url.startsWith('/api/debug')) {
      const results = {};
      try {
        const dbModule = await import('../src/config/database.js');
        results.database = 'imported';
        const row = await dbModule.get('SELECT 1 as alive');
        results.database_query = row;
      } catch (e) {
        results.database_error = e.message;
        results.database_stack = e.stack;
      }

      try {
        const serverModule = await import('../src/server.js');
        results.server = 'imported';
      } catch (e) {
        results.server_error = e.message;
        results.server_stack = e.stack;
      }

      return res.status(200).json(results);
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

    // Normalizing URL for Express when invoked via Vercel rewrites
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
