import { expect, test } from 'vitest';
import { goalProgress } from '@/modules/goals/domain/reserve';
import { acceptTransfer } from '@/modules/ledger/domain/transfers';
import { acceptExpense } from '@/modules/categories/domain/expenses';
import { reserveWithdrawalInput } from '@/modules/goals/domain/reserve-withdrawal';
const terms = {
  type: 'reserve' as const,
  monthlyAmount: '50000',
  coverageMonths: '12',
};
test('600000−50000: expense and transfer remove reached; transfer conserves money', () => {
  const t = acceptTransfer('600000', '0', 'RUB', 'RUB', '50000', '50000');
  expect(t.destinationBalance).toBe('50000.00');
  expect(goalProgress('RUB', t.sourceBalance, terms)).toMatchObject({
    actual: '550000.00',
    remaining: '50000.00',
    coverage: '11',
    reached: false,
    status: 'in_progress',
  });
  expect(
    goalProgress('RUB', acceptExpense('600000', '50000', 'RUB').balance, terms),
  ).toMatchObject({ actual: '550000.00', coverage: '11', reached: false });
});
test('negative balance and zero obligation never yield negative percent or coverage', () => {
  expect(
    goalProgress('RUB', '-5000', {
      ...terms,
      monthlyAmount: '10000',
      coverageMonths: '10',
    }),
  ).toMatchObject({
    actual: '-5000.00',
    remaining: '105000.00',
    percent: null,
    coverage: null,
    reached: false,
    status: 'deficit',
  });
  expect(
    goalProgress('RUB', '-5000', { ...terms, monthlyAmount: '0' }),
  ).toMatchObject({
    remaining: '0.00',
    percent: null,
    coverage: null,
    reached: null,
    status: 'no_obligation',
    deficit: true,
  });
});
test('strict withdrawal contract rejects invalid kind, forged totals and invalid decimal', () => {
  const input = {
    kind: 'expense',
    goalId: '00000000-0000-4000-8000-000000000001',
    accountId: '00000000-0000-4000-8000-000000000002',
    amount: '50000',
    category: { name: 'Платёж' },
    financialDate: '2026-10-17',
  };
  expect(reserveWithdrawalInput.safeParse(input).success).toBe(true);
  for (const patch of [
    { amount: '-1' },
    { amount: '1e3' },
    { amount: 'NaN' },
    { actual: '550000' },
    { kind: 'income' },
    { goalId: 'bad' },
  ])
    expect(
      reserveWithdrawalInput.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
});
