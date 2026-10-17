import { expect, test } from 'vitest';
import {
  savingsAccountSelection,
  eligibleGoalAccounts,
} from '@/modules/goals/domain/savings-account';
import { accountInput } from '@/modules/ledger/domain/accounts-input';
import {
  accountTotals,
  historyBalances,
} from '@/modules/ledger/domain/accounts';
import { goalProgress } from '@/modules/goals/domain/reserve';
const id = '00000000-0000-4000-8000-000000000001';
const account = {
  id,
  name: 'Подушка',
  type: 'accumulation',
  currency: 'RUB',
  balance: '220000.00',
  archived: false,
  occupied: false,
};
test('savings account creation accepts exact existing account contract; goal funds are the same asset', () => {
  expect(
    accountInput.safeParse({
      command: 'create',
      name: account.name,
      type: account.type,
      currency: 'RUB',
      openingBalance: '220000',
    }).success,
  ).toBe(true);
  const progress = goalProgress('RUB', account.balance, {
    type: 'reserve',
    monthlyAmount: '50000',
    coverageMonths: '12',
  });
  expect(progress.actual).toBe('220000.00');
  expect(accountTotals([account])).toEqual([
    { currency: 'RUB', amount: '220000.00' },
  ]);
  expect(eligibleGoalAccounts([account])).toEqual([account]);
});
test('one active goal occupies all account types; editing keeps its current account; archive frees it', () => {
  expect(eligibleGoalAccounts([{ ...account, occupied: true }])).toEqual([]);
  expect(
    eligibleGoalAccounts([{ ...account, occupied: true }], id),
  ).toHaveLength(1);
  expect(eligibleGoalAccounts([{ ...account, archived: true }])).toEqual([]);
  expect(
    eligibleGoalAccounts([{ ...account, archived: true, occupied: true }], id),
  ).toHaveLength(1);
  expect(
    eligibleGoalAccounts([{ ...account, type: 'bank_card' }]),
  ).toHaveLength(1);
});
test('pre-goal history and signs are preserved; no reset or synthetic funding event', () => {
  expect(
    historyBalances('203000', 'RUB', [
      { amount: '20000', role: 'income' },
      { amount: '3000', role: 'expense' },
    ]),
  ).toEqual(['223000.00', '220000.00']);
  expect(accountTotals([{ ...account, balance: '-5000.00' }])).toEqual([
    { currency: 'RUB', amount: '-5000.00' },
  ]);
});
test('selection validates explicit UUID; unexpected funds and workspace payloads are rejected', () => {
  expect(savingsAccountSelection.safeParse({ accountId: id }).success).toBe(
    true,
  );
  for (const input of [
    { accountId: 'invalid' },
    { accountId: id, balance: '1' },
    { accountId: id, workspaceId: id },
  ])
    expect(savingsAccountSelection.safeParse(input).success).toBe(false);
});
