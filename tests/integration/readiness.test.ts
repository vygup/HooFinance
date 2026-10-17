import { expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({ getPool: vi.fn() }));
import { getPool } from '@/server/db/client';
import { isDatabaseReady } from '@/server/db/readiness';

test('Повторное применение миграций не создаёт новые записи', async () => {
  const before = await testPool.query(
    'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  await migrate(drizzle(testPool), {
    migrationsFolder: 'src/server/db/migrations',
  });
  const after = await testPool.query(
    'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  expect(after.rows).toEqual(before.rows);
});

test('Readiness принимает только точную актуальную схему настоящей БД', async () => {
  const client = await testPool.connect();
  vi.mocked(getPool).mockReturnValue(client as unknown as Pool);
  await client.query('BEGIN');
  try {
    expect(await isDatabaseReady()).toBe(true);
    await client.query(
      "UPDATE drizzle.__drizzle_migrations SET hash = 'changed'",
    );
    expect(await isDatabaseReady()).toBe(false);
    await client.query('DELETE FROM drizzle.__drizzle_migrations');
    expect(await isDatabaseReady()).toBe(false);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    vi.mocked(getPool).mockReturnValue(testPool);
  }
  expect(await isDatabaseReady()).toBe(true);
});
