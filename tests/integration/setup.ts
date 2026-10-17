import nextEnv from '@next/env';
import { beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { requireTestDatabase } from '../helpers/database';
nextEnv.loadEnvConfig(process.cwd(), true);
export const testPool = new Pool({
  connectionString: requireTestDatabase(process.env),
  max: 2,
  connectionTimeoutMillis: 5000,
});
beforeAll(async () => {
  await migrate(drizzle(testPool), {
    migrationsFolder: 'src/server/db/migrations',
  });
});
afterAll(async () => {
  await testPool.end();
});
