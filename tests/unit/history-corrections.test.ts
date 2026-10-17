import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  correctionBalances,
  historyInput,
  historyFilters,
} from '@/modules/ledger/domain/history-corrections';

const accountId = randomUUID();
const expense = { accountId, amount: '1000', currency: 'RUB', role: 'expense' };
describe('history correction contract', () => {
  test('backdated amount change reverses old effect before applying new effect', () => {
    expect(
      correctionBalances(
        [{ id: accountId, currency: 'RUB', balanceProjection: '9000' }],
        [expense],
        [{ ...expense, amount: '1500' }],
      ),
    ).toEqual([{ accountId, currency: 'RUB', amount: '8500.00' }]);
    expect(
      correctionBalances(
        [{ id: accountId, currency: 'RUB', balanceProjection: '8500' }],
        [{ ...expense, amount: '1500' }],
        [],
      ),
    ).toEqual([{ accountId, currency: 'RUB', amount: '10000.00' }]);
  });
  test('moving an entry reverses the old account; transfers reverse both legs', () => {
    const other = randomUUID();
    const accounts = [
      { id: accountId, currency: 'RUB', balanceProjection: '9000' },
      { id: other, currency: 'RUB', balanceProjection: '1000' },
    ];
    expect(
      correctionBalances(
        accounts,
        [expense],
        [{ ...expense, accountId: other }],
      ),
    ).toEqual([
      { accountId, currency: 'RUB', amount: '10000.00' },
      { accountId: other, currency: 'RUB', amount: '0.00' },
    ]);
    expect(
      correctionBalances(
        accounts,
        [
          { ...expense, role: 'transfer_out' },
          { ...expense, accountId: other, role: 'transfer_in' },
        ],
        [],
      ),
    ).toEqual([
      { accountId, currency: 'RUB', amount: '10000.00' },
      { accountId: other, currency: 'RUB', amount: '0.00' },
    ]);
  });
  test('preserves large decimals and rejects excess currency precision', () => {
    expect(
      correctionBalances(
        [
          {
            id: accountId,
            currency: 'RUB',
            balanceProjection: '99999999999999999999999.99',
          },
        ],
        [],
        [{ ...expense, amount: '0.01' }],
      )[0]?.amount,
    ).toBe('99999999999999999999999.98');
    expect(() =>
      correctionBalances(
        [{ id: accountId, currency: 'RUB', balanceProjection: '1' }],
        [],
        [{ ...expense, amount: '1.005' }],
      ),
    ).toThrow();
  });
  test('delete requires explicit confirmation; editing cannot specify author or status', () => {
    const actionId = randomUUID();
    expect(
      historyInput.safeParse({
        command: 'delete',
        actionId,
        explicitConfirmation: false,
      }).success,
    ).toBe(false);
    expect(
      historyInput.safeParse({
        command: 'delete',
        actionId,
        explicitConfirmation: true,
      }).success,
    ).toBe(true);
    expect(
      historyInput.safeParse({
        command: 'updateEntry',
        actionId,
        accountId,
        categoryId: randomUUID(),
        amount: '1',
        financialDate: '2026-02-30',
      }).success,
    ).toBe(false);
    expect(
      historyInput.safeParse({
        command: 'delete',
        actionId,
        explicitConfirmation: true,
        actorId: 'forged',
      }).success,
    ).toBe(false);
    expect(
      historyFilters.safeParse({ from: '2026-11-01', to: '2026-10-01' })
        .success,
    ).toBe(false);
  });
});
