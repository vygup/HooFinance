import { expect, test } from 'vitest';
import { goalFundingInput } from '@/modules/goals/domain/goal-funding';
import { acceptTransfer } from '@/modules/ledger/domain/transfers';
import { goalProgress } from '@/modules/goals/domain/reserve';
import { accountTotals } from '@/modules/ledger/domain/accounts';
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const input = {
  goalId: ids[2],
  sourceWorkspaceId: ids[0],
  destinationWorkspaceId: ids[0],
  sourceAccountId: ids[1],
  destinationAccountId: ids[2],
  debitAmount: '20000',
  creditAmount: '20000',
  financialDate: '2026-10-17',
};
test('КУ-008: real transfer 20000 gives 240000/360000/40%/4.8 and conserves account totals', () => {
  const t = acceptTransfer('100000', '220000', 'RUB', 'RUB', '20000', '20000');
  expect(
    goalProgress('RUB', t.destinationBalance, {
      type: 'reserve',
      monthlyAmount: '50000',
      coverageMonths: '12',
    }),
  ).toMatchObject({
    actual: '240000.00',
    remaining: '360000.00',
    percent: '40.00',
    coverage: '4.8',
  });
  expect(
    accountTotals([
      { currency: 'RUB', balance: t.sourceBalance },
      { currency: 'RUB', balance: t.destinationBalance },
    ]),
  ).toEqual([{ currency: 'RUB', amount: '320000.00' }]);
});
test('funding reuses strict transfer input; invalid/same-account/unequal-scale fields cannot become goal money', () => {
  expect(goalFundingInput.safeParse(input).success).toBe(true);
  for (const patch of [
    { goalId: 'bad' },
    { debitAmount: '0' },
    { debitAmount: '1e4' },
    { creditAmount: 'NaN' },
    { destinationAccountId: ids[1] },
    { financialDate: '2026-02-30' },
    { accumulated: '1' },
  ])
    expect(goalFundingInput.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
  expect(() =>
    acceptTransfer('100000', '220000', 'RUB', 'RUB', '20000.001', '20000.001'),
  ).toThrow();
  expect(() =>
    acceptTransfer('100000', '220000', 'RUB', 'RUB', '20000', '19000'),
  ).toThrow();
});
