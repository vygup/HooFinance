import { expect, test } from 'vitest';
import { goalInput, goalProgress } from '@/modules/goals/domain/reserve';
test('КУ-007 reserve target, remaining, percent and coverage are exact', () => {
  expect(
    goalProgress('RUB', '220000', {
      type: 'reserve',
      monthlyAmount: '50000',
      coverageMonths: '12',
    }),
  ).toEqual({
    actual: '220000.00',
    target: '600000.00',
    remaining: '380000.00',
    percent: '36.67',
    coverage: '4.4',
    reached: false,
    status: 'in_progress',
    deficit: false,
  });
  expect(
    goalProgress('RUB', '220000', {
      type: 'reserve',
      monthlyAmount: '55000',
      coverageMonths: '12',
    }),
  ).toMatchObject({
    target: '660000.00',
    coverage: '4',
    remaining: '440000.00',
  });
});
test('zero obligation overrides negative balance; positive obligation deficit has no ratios', () => {
  for (const balance of ['220000', '-5000'])
    expect(
      goalProgress('RUB', balance, {
        type: 'reserve',
        monthlyAmount: '0',
        coverageMonths: '12',
      }),
    ).toMatchObject({
      target: '0.00',
      remaining: '0.00',
      percent: null,
      coverage: null,
      reached: null,
      status: 'no_obligation',
      deficit: balance === '-5000',
    });
  expect(
    goalProgress('RUB', '-5000', {
      type: 'reserve',
      monthlyAmount: '50000',
      coverageMonths: '2',
    }),
  ).toMatchObject({
    target: '100000.00',
    remaining: '105000.00',
    percent: null,
    coverage: null,
    reached: false,
    status: 'deficit',
  });
});
test('ordinary goal, reversible reached, overfunding and coverage above period', () => {
  expect(
    goalProgress('RUB', '100001', {
      type: 'ordinary',
      ordinaryTarget: '100000',
    }),
  ).toMatchObject({
    actual: '100001.00',
    remaining: '0.00',
    reached: true,
    status: 'reached',
    percent: '100.00',
    coverage: null,
  });
  expect(
    goalProgress('RUB', '99999', {
      type: 'ordinary',
      ordinaryTarget: '100000',
    }),
  ).toMatchObject({ remaining: '1.00', reached: false, status: 'in_progress' });
  expect(
    goalProgress('RUB', '700000', {
      type: 'reserve',
      monthlyAmount: '50000',
      coverageMonths: '12',
    }),
  ).toMatchObject({
    actual: '700000.00',
    remaining: '0.00',
    coverage: '14',
    percent: '116.67',
    reached: true,
  });
  expect(
    goalProgress('RUB', '-5000', {
      type: 'ordinary',
      ordinaryTarget: '100000',
    }),
  ).toMatchObject({ remaining: '105000.00', percent: null, status: 'deficit' });
});
test('huge amounts and currency scales remain exact', () => {
  expect(
    goalProgress('RUB', '100000000000000000000000000000000.01', {
      type: 'ordinary',
      ordinaryTarget: '100000000000000000000000000000001.01',
    }).remaining,
  ).toBe('1.00');
  expect(
    goalProgress('JPY', '5', {
      type: 'reserve',
      monthlyAmount: '3',
      coverageMonths: '2',
    }),
  ).toMatchObject({ target: '6', remaining: '1', coverage: '1.67' });
});
test('strict input rejects invalid money, months, dates and future obligation binding', () => {
  const valid = {
    command: 'create',
    type: 'reserve',
    name: 'Подушка',
    accountId: '00000000-0000-4000-8000-000000000001',
    currency: 'RUB',
    monthlyAmount: '50000',
    coverageMonths: '12',
  };
  expect(goalInput.safeParse(valid).success).toBe(true);
  for (const patch of [
    { monthlyAmount: '-1' },
    { monthlyAmount: 'NaN' },
    { monthlyAmount: '1e3' },
    { monthlyAmount: '1.001' },
    { coverageMonths: '0' },
    { coverageMonths: '1.5' },
    { coverageMonths: '-1' },
    { currency: 'ZZZ' },
    { targetDate: '2026-02-30' },
    { linkedObligationId: valid.accountId },
    { ordinaryTarget: '1' },
  ])
    expect(goalInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  expect(goalInput.safeParse({ ...valid, monthlyAmount: '0' }).success).toBe(
    true,
  );
});

test('ordinary malformed amount returns validation without throwing', () => {
  for (const ordinaryTarget of [
    'abc',
    '',
    'NaN',
    'Infinity',
    '0',
    '-1',
    '1.001',
  ])
    expect(
      goalInput.safeParse({
        command: 'create',
        type: 'ordinary',
        name: 'Цель',
        accountId: '00000000-0000-4000-8000-000000000001',
        currency: 'RUB',
        ordinaryTarget,
      }).success,
    ).toBe(false);
});
