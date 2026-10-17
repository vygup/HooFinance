import 'server-only';
import nextEnv from '@next/env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getPool } from './client';
nextEnv.loadEnvConfig(process.cwd());
async function main() {
  const pool = getPool();
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('finance-manager-migrations'))",
      );
      await migrate(drizzle(client), {
        migrationsFolder: 'src/server/db/migrations',
      });
      console.info('MIGRATIONS_APPLIED');
    } finally {
      // Закрытие соединения освобождает session advisory lock и при ошибке миграции.
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('MIGRATION_FAILED');
  process.exitCode = 1;
});
