import { formatMoney } from '@/shared/money/format';
import { describe, expect, test } from 'vitest';
import { accountInput } from '@/modules/ledger/application/accounts-input';
import {
  correctOpeningBalance,
  accountTotals,
  needsNegativeWarning,
} from '@/modules/ledger/domain/accounts';
const create = {
  command: 'create',
  name: 'Банк',
  type: 'bank_card',
  currency: 'RUB',
  openingBalance: '100000',
  description: '',
};
describe('Счета: контракт и точная арифметика', () => {
  test('opening 100000, zero и negative допустимы без доходной операции', () => {
    for (const openingBalance of ['100000', '0', '-100'])
      expect(
        accountInput.safeParse({ ...create, openingBalance }).success,
      ).toBe(true);
    expect(
      correctOpeningBalance('100000.00', '100000.00', '100000', 'RUB'),
    ).toBe('100000.00');
  });
  test('correction 90000 → 107000 сохраняет эффект операций 17000', () => {
    expect(
      correctOpeningBalance('117000.00', '100000.00', '90000', 'RUB'),
    ).toBe('107000.00');
    expect(
      correctOpeningBalance('999999999999999999999999.01', '0', '0.01', 'RUB'),
    ).toBe('999999999999999999999999.02');
  });
  test('архивные средства включены, валюты разделены', () => {
    expect(
      accountTotals([
        { currency: 'RUB', balance: '100000.00' },
        { currency: 'RUB', balance: '-1.00' },
        { currency: 'USD', balance: '12.00' },
      ]),
    ).toEqual([
      { currency: 'RUB', amount: '99999.00' },
      { currency: 'USD', amount: '12.00' },
    ]);
  });
  test('предупреждение только при создании/увеличении минуса', () => {
    expect(needsNegativeWarning('10', '-1')).toBe(true);
    expect(needsNegativeWarning('-1', '-2')).toBe(true);
    expect(needsNegativeWarning('-2', '-1')).toBe(false);
    expect(needsNegativeWarning('1', '0')).toBe(false);
  });
  test('строгий DTO запрещает смену currency/scope, неверную scale и неподтверждённую correction', () => {
    for (const openingBalance of ['1.005', 'NaN', 'Infinity', '1e3'])
      expect(
        accountInput.safeParse({ ...create, openingBalance }).success,
      ).toBe(false);
    expect(accountInput.safeParse({ ...create, type: 'credit' }).success).toBe(
      false,
    );
    expect(
      accountInput.safeParse({
        command: 'update',
        accountId: crypto.randomUUID(),
        name: 'Банк',
        type: 'cash',
        currency: 'USD',
      }).success,
    ).toBe(false);
    expect(
      accountInput.safeParse({
        command: 'correctOpening',
        accountId: crypto.randomUUID(),
        openingBalance: '90000',
        explicitConfirmation: false,
      }).success,
    ).toBe(false);
  });
});

test('Локализация сохраняет все значащие цифры денежной строки', () => {
  expect(formatMoney('999999999999999999999999.01', 'RUB')).toBe(
    '999 999 999 999 999 999 999 999,01 RUB',
  );
  expect(formatMoney('-0.01', 'RUB')).toBe('-0,01 RUB');
});
