import { expect, test } from 'vitest';
import {
  reserveAdjustmentInput,
  adjustedReserveProgress,
} from '@/modules/goals/domain/reserve-adjustment';
const input = {
  command: 'adjustReserve' as const,
  goalId: '00000000-0000-4000-8000-000000000001',
  monthlyAmount: '55000',
  coverageMonths: '12',
};
test('КУ-009: adjustment recalculates target, shortfall and coverage from unchanged balance', () => {
  expect(adjustedReserveProgress('RUB', '220000', input)).toMatchObject({
    actual: '220000.00',
    target: '660000.00',
    remaining: '440000.00',
    coverage: '4',
  });
  expect(
    adjustedReserveProgress('RUB', '220000', { ...input, coverageMonths: '6' }),
  ).toMatchObject({
    target: '330000.00',
    remaining: '110000.00',
    coverage: '4',
  });
});
test('zero removes obligation; positive restores calculations, including deficit and reached', () => {
  for (const balance of ['220000', '-5000']) {
    expect(
      adjustedReserveProgress('RUB', balance, { ...input, monthlyAmount: '0' }),
    ).toMatchObject({
      status: 'no_obligation',
      remaining: '0.00',
      percent: null,
      coverage: null,
      reached: null,
    });
    expect(adjustedReserveProgress('RUB', balance, input).status).toBe(
      balance === '-5000' ? 'deficit' : 'in_progress',
    );
  }
  expect(adjustedReserveProgress('RUB', '660000', input).reached).toBe(true);
});
test('strict adjustment contract rejects negatives, nonfinite, exponent, months and unrelated fields', () => {
  expect(reserveAdjustmentInput.safeParse(input).success).toBe(true);
  for (const patch of [
    { monthlyAmount: '-1' },
    { monthlyAmount: 'NaN' },
    { monthlyAmount: 'Infinity' },
    { monthlyAmount: '1e3' },
    { coverageMonths: '0' },
    { coverageMonths: '1.5' },
    { accountId: input.goalId },
    { currency: 'USD' },
  ])
    expect(
      reserveAdjustmentInput.safeParse({ ...input, ...patch }).success,
    ).toBe(false);
  expect(() =>
    adjustedReserveProgress('RUB', '220000', {
      ...input,
      monthlyAmount: '1.001',
    }),
  ).toThrow();
  expect(
    adjustedReserveProgress('JPY', '5', {
      ...input,
      monthlyAmount: '3',
      coverageMonths: '2',
    }).remaining,
  ).toBe('1');
});
