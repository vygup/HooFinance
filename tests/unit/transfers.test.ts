import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  transferInput,
  acceptTransfer,
} from '@/modules/ledger/domain/transfers';
const input = {
  sourceWorkspaceId: randomUUID(),
  destinationWorkspaceId: randomUUID(),
  sourceAccountId: randomUUID(),
  destinationAccountId: randomUUID(),
  debitAmount: '10000',
  creditAmount: '10000',
  financialDate: '2026-10-17',
};
test('КУ-004: exact conservation and derived rate pair', () => {
  expect(
    acceptTransfer('50000', '20000', 'RUB', 'RUB', '10000', '10000.00'),
  ).toEqual({
    debit: '10000.00',
    credit: '10000.00',
    sourceBalance: '40000.00',
    destinationBalance: '30000.00',
    rateNumerator: '10000.00',
    rateDenominator: '10000.00',
    rateDecimal: '1',
  });
  expect(
    acceptTransfer(
      '999999999999999999999999999999.99',
      '0',
      'RUB',
      'RUB',
      '0.01',
      '0.01',
    ).sourceBalance,
  ).toBe('999999999999999999999999999999.98');
});
test('strict input: positive finite decimals, valid date, distinct accounts; no actor/rate injection', () => {
  expect(transferInput.safeParse(input).success).toBe(true);
  for (const patch of [
    { debitAmount: '0' },
    { creditAmount: '-1' },
    { debitAmount: 'NaN' },
    { debitAmount: '1e2' },
    { financialDate: '2026-02-30' },
    { destinationAccountId: input.sourceAccountId },
    { actorId: 'foreign' },
    { rateDecimal: '2' },
  ])
    expect(transferInput.safeParse({ ...input, ...patch }).success).toBe(false);
});
test('same currency amounts equal without rounding, FX deferred, negative balance explicit', () => {
  for (const args of [
    ['RUB', 'RUB', '1', '2'],
    ['RUB', 'RUB', '1.001', '1.001'],
    ['JPY', 'JPY', '1.1', '1.1'],
    ['RUB', 'USD', '100', '1'],
  ])
    expect(() =>
      acceptTransfer('0', '0', ...(args as [string, string, string, string])),
    ).toThrow();
  expect(acceptTransfer('1', '0', 'RUB', 'RUB', '2', '2').sourceBalance).toBe(
    '-1.00',
  );
});
