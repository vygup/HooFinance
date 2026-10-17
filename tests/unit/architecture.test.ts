import { ESLint } from 'eslint';
import { expect, test } from 'vitest';
const eslint = new ESLint();
test('Lint блокирует клиентские серверные импорты и арифметику денег через number', async () => {
  const client = await eslint.lintText(
    "'use client'; import { getPool } from '@/server/db/client'; export const x = getPool;",
    { filePath: 'src/components/invalid.tsx' },
  );
  expect(
    client[0]?.messages.some(
      (m) => m.ruleId === 'architecture/client-boundary',
    ),
  ).toBe(true);
  const money = await eslint.lintText(
    'export const add = (a: number, b: number) => a + b;',
    { filePath: 'src/shared/money/invalid.ts' },
  );
  expect(
    money[0]?.messages.filter((m) => m.ruleId === 'no-restricted-syntax')
      .length,
  ).toBe(3);
  const valid = await eslint.lintText(
    "import Decimal from 'decimal.js'; export const add = (a: string, b: string) => new Decimal(a).plus(b).toString();",
    { filePath: 'src/shared/money/valid.ts' },
  );
  expect(valid[0]?.errorCount).toBe(0);
});
