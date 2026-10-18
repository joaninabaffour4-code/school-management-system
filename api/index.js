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

        const { setupDatabase } = await import('../src/setupDatabase.js');
        await setupDatabase();
        results.setup_database = 'ok';

        const { seedAcademicData } = await import('../src/seed.js');
        await seedAcademicData();
        results.seed = 'ok';

        const count = await dbModule.get('SELECT count(*) as count FROM users');
        results.user_count = count ? count.count : 0;
        const users = await dbModule.all('SELECT id, username, email, role_id, is_email_verified, status FROM users LIMIT 10');
        results.sample_users = users;
      } catch (e) {
        results.error = e.message;
        results.stack = e.stack;
      }

      return res.status(200).json(results);
    }

    const { default: app } = await import('../src/server.js');
    const { setupDatabase } = await import('../src/setupDatabase.js');
    const { seedAcademicData } = await import('../src/seed.js');

    // Ensure database setup & initial seed run reliably
    if (!global.__db_initialized) {
      if (!global.__db_init_promise) {
        global.__db_init_promise = (async () => {
          try {
            await setupDatabase();
            await seedAcademicData();
            global.__db_initialized = true;
            console.log('[Serverless DB]: Initialized and seeded successfully');
          } catch (dbErr) {
            global.__db_init_promise = null; // Allow retry on failure
            throw dbErr;
          }
        })();
      }
      await global.__db_init_promise;
    }

    // Normalizing URL for Express when invoked via Vercel rewrites
    if (req.headers['x-matched-path'] && !req.url.startsWith('/api')) {
      req.url = req.headers['x-matched-path'];
    }

    // Bypass body-parser in Express if Vercel already consumed and parsed the body
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string' && req.headers['content-type']?.includes('application/json')) {
        try {
          req.body = JSON.parse(req.body);
        } catch (e) {}
      }
      req._body = true;
    }

    // Wrap Express invocation in a Promise so Vercel Serverless awaits HTTP response completion
    return new Promise((resolve) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      app(req, res, (err) => {
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Express Handler Error', message: err.message });
        }
        resolve();
      });
    });
  } catch (err) {
    console.error('[SERVERLESS ERROR]:', err);
    return res.status(500).json({
      error: 'Serverless Handler Initialization Error',
      message: err.message,
      stack: err.stack,
    });
  }
}
