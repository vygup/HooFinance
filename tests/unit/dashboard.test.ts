import { expect, test } from 'vitest';
import { dashboardInput } from '@/modules/reporting/application/dashboard-input';
import { summarizeDashboard } from '@/modules/reporting/domain/dashboard';
const row = {
  role: 'expense',
  currency: 'RUB',
  amount: '0.01',
  financialDate: '2026-10-01',
  categoryId: null,
  categoryName: null,
};
test('строгий запрос содержит только явное пространство; месяц и actor определяет сервер', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  expect(dashboardInput.parse({ workspaceId })).toEqual({ workspaceId });
  for (const input of [
    {},
    { workspaceId: 'bad' },
    { workspaceId, actorId: 'x' },
    { workspaceId, month: '2026-01' },
    { workspaceId, currency: 'RUB' },
  ])
    expect(dashboardInput.safeParse(input).success).toBe(false);
});
test('балансы включают цель, резерв и архивный счёт ровно один раз; валюты раздельны', () => {
  const accounts = [
    { currency: 'RUB', balance: '100000.00' },
    { currency: 'RUB', balance: '200000.00' },
    { currency: 'RUB', balance: '-0.01' },
    { currency: 'USD', balance: '1.01' },
  ];
  const result = summarizeDashboard(
    accounts,
    [
      row,
      { ...row, role: 'income', amount: '100' },
      { ...row, role: 'transfer_in', amount: '200000' },
      { ...row, role: 'transfer_out', amount: '200000' },
    ],
    [],
  );
  expect(result.balances).toEqual([
    { currency: 'RUB', amount: '299999.99' },
    { currency: 'USD', amount: '1.01' },
  ]);
  expect(result.monthly).toEqual([
    { currency: 'RUB', income: '100.00', expense: '0.01', difference: '99.99' },
    { currency: 'USD', income: '0.00', expense: '0.00', difference: '0.00' },
  ]);
});
test('пустое пространство не создаёт фиктивные деньги; валюта плана даёт явный нулевой факт', () => {
  expect(summarizeDashboard([], [], [])).toEqual({ balances: [], monthly: [] });
  expect(summarizeDashboard([], [], ['JPY']).monthly).toEqual([
    { currency: 'JPY', income: '0', expense: '0', difference: '0' },
  ]);
});
test('точность больших сумм и минимальных единиц совпадает с историей', () => {
  const result = summarizeDashboard(
    [
      { currency: 'RUB', balance: '999999999999999999999999.99' },
      { currency: 'RUB', balance: '0.01' },
    ],
    [row, { ...row, amount: '999999999999999999999999.99' }],
    [],
  );
  expect(result.balances[0]?.amount).toBe('1000000000000000000000000.00');
  expect(result.monthly[0]?.expense).toBe('1000000000000000000000000.00');
});
