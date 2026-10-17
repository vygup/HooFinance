import { expect, test } from 'vitest';
import {
  createFamilyInput,
  familyInput,
  invitationResponseInput,
} from '@/modules/workspaces/application/family-input';
import { encodeHistoryCsv } from '@/shared/csv/history';
test('Family inputs normalize names/email and reject role/actor injection', () => {
  expect(
    createFamilyInput.parse({
      name: ' Семья ',
      timezone: 'Europe/Moscow',
      operationKey: crypto.randomUUID(),
    }).name,
  ).toBe('Семья');
  expect(
    familyInput.parse({ command: 'invite', email: ' TEST@Example.org ' }),
  ).toEqual({ command: 'invite', email: 'test@example.org' });
  expect(
    familyInput.safeParse({
      command: 'invite',
      email: 'a@example.org',
      role: 'owner',
    }).success,
  ).toBe(false);
  expect(
    createFamilyInput.safeParse({
      name: 'A',
      timezone: 'bad',
      operationKey: crypto.randomUUID(),
    }).success,
  ).toBe(false);
});
test('Deletion requires explicit confirmation; ownership recipient and offer are explicit', () => {
  expect(
    familyInput.safeParse({ command: 'delete', explicitConfirmation: false })
      .success,
  ).toBe(false);
  expect(
    familyInput.safeParse({ command: 'offer', recipientId: 'member' }).success,
  ).toBe(true);
  expect(
    familyInput.safeParse({ command: 'acceptOwnership', offerId: 'bad' })
      .success,
  ).toBe(false);
  for (const decision of ['accept', 'reject'])
    expect(
      invitationResponseInput.safeParse({
        decision,
        secret: 'secret',
        operationKey: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  expect(
    familyInput.safeParse({ command: 'cancelInvite', invitationId: 'id' })
      .success,
  ).toBe(true);
  expect(
    familyInput.safeParse({ command: 'remove', memberId: 'id' }).success,
  ).toBe(true);
});
test('CSV preserves Decimal strings, quotes, multiline, BOM/CRLF and protects formula text', () => {
  const csv = encodeHistoryCsv([
    {
      id: 'leg',
      revision: 1,
      type: 'income',
      date: '2026-10-17',
      account: ' \t=SUM(1)',
      currency: 'RUB',
      amount: '10000000000000000000.01',
      category: '"Тест"',
      description: 'строка\nстрока',
      transferId: '',
      direction: '',
      counterpartyAccount: '',
      counterpartyCurrency: '',
      counterpartyAmount: '',
      rateNumerator: '',
      rateDenominator: '',
    },
  ]);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\' \t=SUM(1)"');
  expect(csv).toContain('"""Тест"""');
  expect(csv).toContain('10000000000000000000.01');
  expect(csv.endsWith('\r\n')).toBe(true);
});

test.each([
  '=1+1',
  ' +cmd',
  '\ttext',
  '\rtext',
  "'original",
  '\u0000 @formula',
])('CSV shields text prefix %j', (account) => {
  const csv = encodeHistoryCsv([
    {
      id: 'id',
      revision: 1,
      type: 'income',
      date: '2026-10-17',
      account,
      currency: 'RUB',
      amount: '1.00',
      category: '',
      description: '',
      transferId: '',
      direction: '',
      counterpartyAccount: '',
      counterpartyCurrency: '',
      counterpartyAmount: '',
      rateNumerator: '',
      rateDenominator: '',
    },
  ]);
  expect(csv).toContain('"\'' + account + '"');
});
test('CSV rejects monetary formulas/exponents instead of writing them as numbers', () => {
  const row = {
    id: 'id',
    revision: 1,
    type: 'income',
    date: '2026-10-17',
    account: 'Счёт',
    currency: 'RUB',
    amount: '=1+1',
    category: '',
    description: '',
    transferId: '',
    direction: '',
    counterpartyAccount: '',
    counterpartyCurrency: '',
    counterpartyAmount: '',
    rateNumerator: '',
    rateDenominator: '',
  };
  expect(() => encodeHistoryCsv([row])).toThrow('INVALID_DECIMAL');
  expect(() => encodeHistoryCsv([{ ...row, amount: '1e5' }])).toThrow(
    'INVALID_DECIMAL',
  );
});
