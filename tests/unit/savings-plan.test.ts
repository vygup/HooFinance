import { expect, test } from 'vitest';
import {
  savingsProjection,
  savingsPlanInput,
} from '@/modules/goals/domain/savings-plan';
const base = {
  currency: 'RUB',
  remaining: '360000',
  status: 'in_progress',
  today: '2026-10-17',
  targetDate: '2027-09-17',
  anchorDate: '2026-10-17',
  monthlyContribution: '30000',
};
test('КУ-010: twelve contributions and ceil to minor unit', () => {
  expect(savingsProjection(base)).toMatchObject({
    count: '12',
    recommendation: '30000.00',
    forecastDate: '2027-09-17',
    late: false,
  });
  expect(
    savingsProjection({
      ...base,
      remaining: '100',
      targetDate: '2026-12-17',
      monthlyContribution: '33.34',
    }),
  ).toMatchObject({
    count: '3',
    recommendation: '33.34',
    forecastDate: '2026-12-17',
  });
});
test('default/custom dates, inclusive boundary and original day recovery', () => {
  for (const [anchorDate, count] of [
    ['2026-10-17', '2'],
    ['2026-10-25', '2'],
    ['2026-11-25', '1'],
    ['2026-12-02', '0'],
  ] as const)
    expect(
      savingsProjection({ ...base, anchorDate, targetDate: '2026-12-01' })
        .count,
    ).toBe(count);
  expect(
    savingsProjection({
      ...base,
      today: '2027-02-01',
      anchorDate: '2027-01-31',
      targetDate: '2027-03-31',
      remaining: '100',
      monthlyContribution: '50',
    }),
  ).toMatchObject({
    nextDate: '2027-02-28',
    count: '2',
    forecastDate: '2027-03-31',
  });
});
test('expired/no dates/zero/missing plan/no deadline/reached/no obligation', () => {
  expect(
    savingsProjection({ ...base, targetDate: '2026-10-16' }),
  ).toMatchObject({
    state: 'expired',
    count: '0',
    recommendation: null,
    late: true,
  });
  expect(
    savingsProjection({ ...base, anchorDate: '2028-01-01' }),
  ).toMatchObject({ state: 'no_dates', recommendation: null });
  for (const monthlyContribution of [null, '0'])
    expect(
      savingsProjection({ ...base, monthlyContribution }).forecastDate,
    ).toBeNull();
  expect(savingsProjection({ ...base, targetDate: null })).toMatchObject({
    state: 'no_deadline',
    recommendation: null,
  });
  expect(
    savingsProjection({ ...base, remaining: '0', status: 'reached' }),
  ).toMatchObject({
    state: 'reached',
    recommendation: '0.00',
    forecastDate: null,
  });
  expect(
    savingsProjection({ ...base, remaining: '0', status: 'no_obligation' }),
  ).toMatchObject({ state: 'no_obligation', recommendation: null });
});
test('strict input and dynamic precision with huge amounts', () => {
  for (const monthlyContribution of ['-1', 'NaN', 'Infinity', '1e3'])
    expect(
      savingsPlanInput.safeParse({
        command: 'configureSavings',
        goalId: '00000000-0000-4000-8000-000000000001',
        anchorDate: '2026-10-17',
        monthlyContribution,
      }).success,
    ).toBe(false);
  expect(
    savingsProjection({
      ...base,
      remaining: '1' + '0'.repeat(100),
      monthlyContribution: '0.01',
    }),
  ).toMatchObject({ forecastDate: null, forecastOutOfRange: true });
});
test('currency scale, deficit and late forecast keep exact strings', () => {
  expect(
    savingsProjection({
      ...base,
      currency: 'JPY',
      remaining: '100',
      targetDate: '2026-12-17',
    }).recommendation,
  ).toBe('34');
  expect(
    savingsProjection({
      ...base,
      currency: 'KWD',
      remaining: '100',
      targetDate: '2026-12-17',
    }).recommendation,
  ).toBe('33.334');
  expect(
    savingsProjection({
      ...base,
      remaining: '105000',
      status: 'deficit',
      targetDate: '2026-10-17',
      monthlyContribution: '50000',
    }),
  ).toMatchObject({
    recommendation: '105000.00',
    forecastDate: '2026-12-17',
    late: true,
  });
});
