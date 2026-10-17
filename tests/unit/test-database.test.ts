import { expect, test } from 'vitest';
import { requireTestDatabase } from '../helpers/database';
test('Тесты отклоняют рабочую, удалённую и отсутствующую БД', () => {
  for (const env of [
    {},
    { TEST_DATABASE_URL: 'postgresql://localhost/finance' },
    { TEST_DATABASE_URL: 'postgresql://remote.invalid/finance_test' },
    {
      TEST_DATABASE_URL: 'postgresql://localhost/finance_test',
      DATABASE_URL: 'postgresql://other@127.0.0.1/finance_test',
    },
  ])
    expect(() => requireTestDatabase(env)).toThrow();
  expect(
    requireTestDatabase({
      TEST_DATABASE_URL: 'postgresql://localhost:5433/finance_test',
    }),
  ).toContain('5433');
});
