import { setupDatabase } from '../setupDatabase.js';
import { all, get } from '../config/database.js';

async function migrate() {
  console.log('Running database setup and migrations...');
  await setupDatabase();
  console.log('Database schema successfully migrated!');

  const tables = await all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('Active tables:', tables.map((t) => t.name));

  const users = await all('SELECT id, username, email, first_name, last_name, role_id, is_email_verified FROM users');
  console.log('Current users:');
  console.table(users);

  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
