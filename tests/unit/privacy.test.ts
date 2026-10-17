import { expect, test } from 'vitest';
import { privacyInput } from '@/modules/workspaces/application/privacy-input';
import { belongsToScope } from '@/modules/workspaces/domain/privacy';
import { projectLeg, privateJson } from '@/server/security/projection';
const id = '00000000-0000-4000-8000-000000000001';
test('scope is explicit; forged actor, mode and malformed id are rejected', () => {
  expect(privacyInput.safeParse({ workspaceId: id }).success).toBe(true);
  for (const input of [
    {},
    { workspaceId: '../secret' },
    { workspaceId: id, actorId: 'owner' },
    { workspaceId: id, mode: 'owner' },
  ])
    expect(privacyInput.safeParse(input).success).toBe(false);
  expect(belongsToScope(id, id)).toBe(true);
  expect(belongsToScope('foreign', id)).toBe(false);
});
test('transfer projection keeps exact amounts and never serializes opposite side or raw fields', () => {
  const leg = {
    id,
    workspaceId: id,
    accountId: id,
    amount: '10000.01',
    currency: 'RUB',
    financialDate: '2026-10-18',
    role: 'transfer_in',
    privateDescription: 'Семейная сторона',
    personalAccountName: 'secret',
    token: 'secret',
  };
  expect(projectLeg(leg, id)).toEqual({
    id,
    accountId: id,
    amount: '10000.01',
    currency: 'RUB',
    financialDate: '2026-10-18',
    role: 'transfer_in',
    description: 'Семейная сторона',
  });
  expect(() => projectLeg(leg, 'foreign')).toThrow('FORBIDDEN');
  expect(
    privateJson({ status: 'forbidden' }, 403).headers.get('cache-control'),
  ).toBe('private, no-store');
});
