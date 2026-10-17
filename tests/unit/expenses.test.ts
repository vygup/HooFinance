import { expect, test } from 'vitest';
import {
  acceptExpense,
  expenseInput,
  categoryInput,
} from '@/modules/categories/domain/expenses';
test('expense exact subtraction and negative warning', () => {
  expect(acceptExpense('120000', '3000', 'RUB')).toEqual({
    amount: '3000.00',
    balance: '117000.00',
    warning: false,
  });
  expect(acceptExpense('1000', '1500', 'RUB')).toEqual({
    amount: '1500.00',
    balance: '-500.00',
    warning: true,
  });
  expect(acceptExpense('-500', '1', 'RUB').warning).toBe(true);
  expect(acceptExpense('1', '1', 'RUB').warning).toBe(false);
});
test('expense rejects invalid precision, sign, date and injected currency', () => {
  for (const amount of ['0', '-1', '1.001', 'NaN', '1e3'])
    expect(() => acceptExpense('0', amount, 'RUB')).toThrow();
  expect(
    expenseInput.safeParse({
      accountId: crypto.randomUUID(),
      category: { name: 'Продукты' },
      amount: '3000',
      financialDate: '2026-10-17',
    }).success,
  ).toBe(true);
  expect(expenseInput.safeParse({ currency: 'RUB' }).success).toBe(false);
});
test('category commands preserve type and require version via envelope', () => {
  expect(
    categoryInput.safeParse({
      command: 'create',
      name: 'Продукты',
      kind: 'expense',
    }).success,
  ).toBe(true);
  expect(
    categoryInput.safeParse({
      command: 'update',
      id: crypto.randomUUID(),
      name: 'Еда',
      kind: 'income',
    }).success,
  ).toBe(false);
  expect(
    categoryInput.safeParse({ command: 'archive', id: crypto.randomUUID() })
      .success,
  ).toBe(true);
});
