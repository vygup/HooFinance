import { expect, test } from 'vitest';
import { testPool } from './setup';
test('Базовая миграция записана; PostgreSQL возвращает NUMERIC строкой', async () => {
  const result = await testPool.query(
    "SELECT '9007199254740993.01'::numeric AS amount",
  );
  expect(result.rows[0].amount).toBe('9007199254740993.01');
  const journal = await testPool.query(
    'SELECT hash FROM drizzle.__drizzle_migrations',
  );
  expect(journal.rows.length).toBeGreaterThan(0);
});
