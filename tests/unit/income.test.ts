import { expect, test } from 'vitest';
import {
  incomeInput,
  acceptIncome,
  incomeTotals,
} from '@/modules/ledger/domain/income';
const input = {
  accountId: '57b6d286-73b8-47e8-8ca0-06db8eb3c7f1',
  category: { name: 'Зарплата' },
  amount: '20000',
  financialDate: '2026-10-17',
};
test('income: exact 100000+20000=120000, negative balance improves', () => {
  expect(acceptIncome('100000', '20000', 'RUB')).toEqual({
    amount: '20000.00',
    balance: '120000.00',
  });
  expect(acceptIncome('-500', '1', 'RUB').balance).toBe('-499.00');
  expect(
    acceptIncome('999999999999999999999999.99', '0.01', 'RUB').balance,
  ).toBe('1000000000000000000000000.00');
});
test('strict DTO: valid date/category; reject zero, negative, exponent, invalid date, extra currency/scope', () => {
  expect(incomeInput.safeParse(input).success).toBe(true);
  for (const amount of ['0', '-1', 'NaN', 'Infinity', '1e3', '1,2'])
    expect(incomeInput.safeParse({ ...input, amount }).success).toBe(false);
  for (const patch of [
    { financialDate: '2026-02-30' },
    { currency: 'USD' },
    { workspaceId: input.accountId },
    { category: { name: '' } },
    { category: { id: input.accountId, name: 'x' } },
  ])
    expect(incomeInput.safeParse({ ...input, ...patch }).success).toBe(false);
});
test('currency scale checked without rounding', () => {
  expect(() => acceptIncome('0', '1.001', 'RUB')).toThrow();
  expect(() => acceptIncome('0', '1.1', 'JPY')).toThrow();
  expect(() => acceptIncome('0', '0', 'RUB')).toThrow();
});
test('period totals keep currencies separate, opening absent', () => {
  expect(
    incomeTotals([
      { amount: '20000', currency: 'RUB' },
      { amount: '0.01', currency: 'RUB' },
      { amount: '2', currency: 'USD' },
    ]),
  ).toEqual([
    { currency: 'RUB', amount: '20000.01' },
    { currency: 'USD', amount: '2.00' },
  ]);
});
