import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor } from './auth-fixture';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { workspace } from '@/server/db/schema/workspaces';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  ledgerLeg,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import {
  createFamily,
  familyCommand,
  respondFamilyInvitation,
} from '@/modules/workspaces/application/family';
import { member, invitation } from '@/server/db/schema/identity';
import { mockMail } from './auth-fixture';
import { encryptToken } from '@/server/security/encryption';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import { z } from 'zod';
import { seedAccountHistory } from '../helpers/account-history';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  return {
    ...actor,
    scope: scope!,
    envelope: { workspaceId: scope!.id, operationKey: randomUUID() },
  };
}
const payload = {
  command: 'create',
  name: 'Банк',
  type: 'bank_card',
  currency: 'RUB',
  openingBalance: '100000',
};
async function created(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await accountCommand(f.headers, f.envelope, payload);
  expect(r.status).toBe('success');
  if (r.status !== 'success') throw new Error('FIXTURE_ACCOUNT');
  return r.data;
}
test('create повторяется конкурентно один раз, zero/negative, нет фиктивных доходов', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    accountCommand(f.headers, f.envelope, payload),
    accountCommand(f.headers, f.envelope, payload),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe('success');
  const page = await readAccounts(f.headers, f.scope.id);
  expect(page.accounts).toHaveLength(1);
  expect(page.accounts[0]?.balance).toBe('100000.00');
  expect(page.accounts[0]?.history).toEqual([]);
  for (const openingBalance of ['0', '-50'])
    expect(
      (
        await accountCommand(
          f.headers,
          { ...f.envelope, operationKey: randomUUID() },
          { ...payload, openingBalance },
        )
      ).status,
    ).toBe('success');
  expect((await readAccounts(f.headers, f.scope.id)).totals).toEqual([
    { currency: 'RUB', amount: '99950.00' },
  ]);
  expect(
    (
      await accountCommand(f.headers, f.envelope, {
        ...payload,
        name: 'Другая',
      })
    ).status,
  ).toBe('conflict');
});
test('correction 90000→107000, immutable legs, historical balances и audit; archive сохраняет всё', async () => {
  const f = await fixture(),
    account = await created(f);
  await seedAccountHistory(testPool, f.scope.id, account.id, f.actorId);
  const legs = await db
    .select()
    .from(ledgerLeg)
    .where(eq(ledgerLeg.accountId, account.id));
  const run = (input: unknown, version = '1') =>
    accountCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID(), expectedVersion: version },
      input,
    );
  expect(
    (
      await run({
        command: 'correctOpening',
        accountId: account.id,
        openingBalance: '90000',
        explicitConfirmation: false,
      })
    ).status,
  ).toBe('validation');
  const r = await run({
    command: 'correctOpening',
    accountId: account.id,
    openingBalance: '90000',
    explicitConfirmation: true,
  });
  expect(r.status).toBe('success');
  if (r.status !== 'success') throw new Error('EXPECTED_SUCCESS');
  expect(r.data.balance).toBe('107000.00');
  expect(r.data.history.map((h) => h.balance)).toEqual([
    '110000.00',
    '107000.00',
  ]);
  expect(r.data.history.map((h) => h.amount)).toEqual(['20000.00', '3000.00']);
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.accountId, account.id)),
  ).toEqual(legs);
  const events = await db
    .select()
    .from(scopedAuditEvent)
    .where(
      and(
        eq(scopedAuditEvent.objectId, account.id),
        eq(scopedAuditEvent.kind, 'correctOpening'),
      ),
    );
  expect(events).toHaveLength(1);
  expect(events[0]?.actorId).toBe(f.actorId);
  expect(events[0]?.occurredAt).toBeInstanceOf(Date);
  expect(events[0]?.beforeScope).toMatchObject({ openingBalance: '100000.00' });
  expect(events[0]?.afterScope).toMatchObject({
    openingBalance: '90000.00',
    balance: '107000.00',
  });
  expect(
    (
      await run(
        {
          command: 'update',
          accountId: account.id,
          name: 'Новое имя',
          type: 'cash',
          description: 'Заметка',
        },
        '2',
      )
    ).status,
  ).toBe('success');
  expect(
    (await run({ command: 'archive', accountId: account.id }, '3')).status,
  ).toBe('success');
  const page = await readAccounts(f.headers, f.scope.id);
  expect(page.accounts[0]).toMatchObject({
    name: 'Новое имя',
    archived: true,
    balance: '107000.00',
  });
  expect(page.accounts[0]?.history).toHaveLength(2);
  expect(page.availableAccounts).toHaveLength(0);
  expect(page.totals).toEqual([{ currency: 'RUB', amount: '107000.00' }]);
  expect(
    (
      await run(
        {
          command: 'correctOpening',
          accountId: account.id,
          openingBalance: '100000',
          explicitConfirmation: true,
        },
        '4',
      )
    ).status,
  ).toBe('success');
});
test('versions, negative confirmation rollback и stale token', async () => {
  const f = await fixture(),
    a = await created(f);
  const command = {
    command: 'correctOpening',
    accountId: a.id,
    openingBalance: '-1',
    explicitConfirmation: true,
  };
  const e = { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' };
  const r = await accountCommand(f.headers, e, command);
  expect(r.status).toBe('confirmation_required');
  if (r.status !== 'confirmation_required') throw new Error('CONFIRMATION');
  expect((await readAccounts(f.headers, f.scope.id)).accounts[0]?.balance).toBe(
    '100000.00',
  );
  expect(
    await db
      .select()
      .from(commandReceipt)
      .where(eq(commandReceipt.operationKey, e.operationKey)),
  ).toHaveLength(0);
  expect(
    (
      await accountCommand(
        f.headers,
        { ...e, confirmationToken: r.confirmationToken },
        command,
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await accountCommand(
        f.headers,
        { ...e, operationKey: randomUUID() },
        { command: 'archive', accountId: a.id },
      )
    ).status,
  ).toBe('conflict');
  const e2 = { ...e, operationKey: randomUUID(), expectedVersion: '2' };
  const c2 = { ...command, openingBalance: '-2' };
  const warning = await accountCommand(f.headers, e2, c2);
  if (warning.status !== 'confirmation_required')
    throw new Error('CONFIRMATION');
  await db
    .update(financialAccount)
    .set({ version: 3n })
    .where(eq(financialAccount.id, a.id));
  const stale = await accountCommand(
    f.headers,
    {
      ...e2,
      expectedVersion: '3',
      confirmationToken: warning.confirmationToken,
    },
    c2,
  );
  expect(stale.status).toBe('confirmation_required');
});
test('чужой workspace/account, raw DTO currency, missing session и rollback после audit failure', async () => {
  const f = await fixture(),
    a = await created(f),
    other = await fixture();
  await expect(readAccounts(other.headers, f.scope.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (
      await accountCommand(
        other.headers,
        { ...other.envelope, expectedVersion: '1' },
        { command: 'archive', accountId: a.id },
      )
    ).status,
  ).toBe('forbidden');
  expect(
    (await accountCommand(new Headers(), f.envelope, payload)).status,
  ).toBe('unauthorized');
  expect(
    (
      await accountCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
        {
          command: 'update',
          accountId: a.id,
          name: 'Хак',
          type: 'cash',
          currency: 'USD',
        },
      )
    ).status,
  ).toBe('validation');
  const trigger = `account_failure_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id = '${a.id}' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  const e = { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' };
  try {
    expect(
      (
        await accountCommand(f.headers, e, {
          command: 'correctOpening',
          accountId: a.id,
          openingBalance: '90000',
          explicitConfirmation: true,
        })
      ).status,
    ).toBe('unavailable');
    expect(
      (await readAccounts(f.headers, f.scope.id)).accounts[0],
    ).toMatchObject({ openingBalance: '100000.00', version: '1' });
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, e.operationKey)),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
});

test('семейный member управляет общим счётом; отзыв доступа запрещает receipt retry; архив блокирует новые операции', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const result = await createFamily(
    owner.headers,
    {
      name: 'Общие счета',
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    },
    mockMail,
  );
  if (result.status !== 'success') throw new Error('FAMILY_FIXTURE');
  const family = result.data;
  const envelope = {
    workspaceId: family.id,
    operationKey: randomUUID(),
    expectedVersion: family.version,
  };
  expect(
    (
      await familyCommand(
        owner.headers,
        envelope,
        { command: 'invite', email: guest.email },
        mockMail,
      )
    ).status,
  ).toBe('success');
  const [invite] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, family.organizationId));
  expect(
    (
      await respondFamilyInvitation(guest.headers, {
        secret: encryptToken(invite!.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('success');
  const e = { workspaceId: family.id, operationKey: randomUUID() };
  const created = await accountCommand(guest.headers, e, payload);
  if (created.status !== 'success') throw new Error('ACCOUNT_FIXTURE');
  expect((await readAccounts(owner.headers, family.id)).accounts).toHaveLength(
    1,
  );
  expect(
    (
      await accountCommand(
        owner.headers,
        { ...e, operationKey: randomUUID(), expectedVersion: '1' },
        { command: 'archive', accountId: created.data.id },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await financialTransaction({
        headers: owner.headers,
        envelope: { ...e, operationKey: randomUUID() },
        payload: {},
        payloadSchema: z.object({}),
        workspaceIds: [family.id],
        accountIds: [created.data.id],
        execute: async () => {
          throw new Error('MUST_NOT_EXECUTE');
        },
        project: async () => ({}),
      })
    ).status,
  ).toBe('forbidden');
  const [membership] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, family.organizationId),
        eq(member.userId, guest.actorId),
      ),
    );
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...envelope, operationKey: randomUUID() },
        { command: 'remove', memberId: membership!.id },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect((await accountCommand(guest.headers, e, payload)).status).toBe(
    'forbidden',
  );
  await expect(readAccounts(guest.headers, family.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...envelope, operationKey: randomUUID() },
        { command: 'delete', explicitConfirmation: true },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await accountCommand(
        owner.headers,
        { ...e, operationKey: randomUUID() },
        payload,
      )
    ).status,
  ).toBe('forbidden');
});
