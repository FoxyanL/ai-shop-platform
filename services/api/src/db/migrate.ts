import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../config.js';
import { database, closeConnections } from './pool.js';

async function migrate() {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
  const sql = await readFile(path.join(directory, '001_initial.sql'), 'utf8');
  await database.query(sql);

  if (config.BOOTSTRAP_ADMIN_EMAIL) {
    await database.query(
      `INSERT INTO users (email, role, email_verified)
       VALUES ($1, 'platform_admin', TRUE)
       ON CONFLICT (email) DO UPDATE SET role = 'platform_admin', updated_at = NOW()`,
      [config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()],
    );
  }
}

migrate()
  .catch((error: unknown) => {
    console.error('Не удалось применить миграции базы данных', error);
    process.exitCode = 1;
  })
  .finally(closeConnections);
