import { expect, test } from 'vitest';
import {
  budgetInput,
  calculateBudget,
} from '@/modules/budgeting/domain/monthly-budget';
const id = '00000000-0000-4000-8000-000000000001';
test('КУ-005: exact plans, overspend and all unbudgeted expenses', () => {
  const limits = ['50000', '30000', '10000', '15000', '10000'].map(
    (amount, i) => ({ categoryId: String(i), amount }),
  );
  const result = calculateBudget('RUB', '200000', limits, [
    { categoryId: '1', currency: 'RUB', amount: '33000' },
    { categoryId: 'other', currency: 'RUB', amount: '2000' },
    { categoryId: '1', currency: 'USD', amount: '999' },
  ]);
  expect(result).toMatchObject({
    plannedExpenses: '115000.00',
    plannedRemainder: '85000.00',
    actual: '35000.00',
    remaining: '80000.00',
  });
  expect(result.categories.find((c) => c.categoryId === '1')).toMatchObject({
    remaining: '-3000.00',
    percent: '110.00',
    exceeded: true,
  });
  expect(result.categories.find((c) => c.categoryId === 'other')).toMatchObject(
    { limit: null, remaining: null, percent: null, actual: '2000.00' },
  );
});
test('zero limit and no limit are distinct; large amounts remain exact', () => {
  const result = calculateBudget(
    'RUB',
    '100000000000000000000000000000000.01',
    [{ categoryId: id, amount: '0' }],
    [{ categoryId: id, currency: 'RUB', amount: '0.01' }],
  );
  expect(result.plannedRemainder).toBe('100000000000000000000000000000000.01');
  expect(result.categories[0]).toMatchObject({
    limit: '0.00',
    remaining: '-0.01',
    percent: null,
    exceeded: true,
  });
  expect(calculateBudget('RUB', '0', [], []).actual).toBe('0.00');
});
test('strict finite nonnegative currency-scale input and unique category limits', () => {
  const valid = {
    month: '2026-10',
    currency: 'RUB',
    plannedIncome: '200000',
    categoryLimits: [{ categoryId: id, amount: '0' }],
  };
  expect(budgetInput.safeParse(valid).success).toBe(true);
  for (const patch of [
    { month: '0000-10' },
    { month: '2026-13' },
    { currency: 'ZZZ' },
    { plannedIncome: '-1' },
    { plannedIncome: 'NaN' },
    { plannedIncome: '1e3' },
    { plannedIncome: '1.001' },
    { categoryLimits: [...valid.categoryLimits, ...valid.categoryLimits] },
    { categoryLimits: [{ categoryId: id, amount: '-1' }] },
  ])
    expect(budgetInput.safeParse({ ...valid, ...patch }).success).toBe(false);
});
