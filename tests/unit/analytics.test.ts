import { expect, test } from 'vitest';
import { analyticsInput } from '@/modules/reporting/application/analytics-input';
import {
  analyticsPeriod,
  summarizeAnalytics,
} from '@/modules/reporting/domain/analytics';
test('границы месяца, прошлого месяца, года и включительный произвольный период', () => {
  expect(analyticsPeriod({ period: 'current' }, '2026-01-10')).toEqual({
    from: '2026-01-01',
    until: '2026-01-31',
  });
  expect(analyticsPeriod({ period: 'previous' }, '2026-01-10')).toEqual({
    from: '2025-12-01',
    until: '2025-12-31',
  });
  expect(analyticsPeriod({ period: 'year' }, '2024-02-29')).toEqual({
    from: '2024-01-01',
    until: '2024-12-31',
  });
  expect(
    analyticsPeriod(
      { period: 'custom', from: '2024-02-29', until: '2024-02-29' },
      '2026-01-10',
    ),
  ).toEqual({ from: '2024-02-29', until: '2024-02-29' });
});
test('строгий DTO отклоняет неверные даты, обратный период и подмену контекста', () => {
  for (const input of [
    { period: 'custom', from: '2026-02-30', until: '2026-03-01' },
    { period: 'custom', from: '2026-03-02', until: '2026-03-01' },
    { period: 'year', actorId: 'x' },
    { period: 'custom' },
  ])
    expect(analyticsInput.safeParse(input).success).toBe(false);
});
test('точные категории 25000, отдельные валюты, динамика и отсутствие переводов', () => {
  const row = {
    role: 'expense',
    currency: 'RUB',
    categoryId: 'food',
    categoryName: 'Питание',
    financialDate: '2026-10-01',
  };
  const report = summarizeAnalytics([
    { ...row, amount: '10000' },
    { ...row, amount: '15000' },
    { ...row, role: 'income', amount: '30000' },
    { ...row, role: 'transfer_in', amount: '900000' },
    { ...row, currency: 'USD', amount: '0.01' },
  ]);
  expect(report.totals).toEqual([
    {
      currency: 'RUB',
      income: '30000.00',
      expense: '25000.00',
      difference: '5000.00',
    },
    { currency: 'USD', income: '0.00', expense: '0.01', difference: '-0.01' },
  ]);
  expect(
    report.categories.find((c) => c.currency === 'RUB' && c.role === 'expense')
      ?.amount,
  ).toBe('25000.00');
  expect(report.dynamics.find((c) => c.currency === 'RUB')?.expense).toBe(
    '25000.00',
  );
  expect(
    report.categories.every((c) => c.coordinate >= 0 && c.coordinate <= 1),
  ).toBe(true);
  expect(summarizeAnalytics([])).toEqual({
    totals: [],
    categories: [],
    dynamics: [],
  });
});
test('большие суммы не теряют младшие разряды', () => {
  const report = summarizeAnalytics(
    ['999999999999999999999999.99', '0.01'].map((amount) => ({
      amount,
      currency: 'RUB',
      role: 'expense',
      categoryId: 'x',
      categoryName: 'X',
      financialDate: '2026-10-01',
    })),
  );
  expect(report.totals[0]?.expense).toBe('1000000000000000000000000.00');
});
