import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor, mockMail } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  ledgerLeg,
  financialAction,
  actionRevision,
  transferDetail,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import {
  createTransfer,
  readTransfers,
  readTransferOptions,
} from '@/modules/ledger/application/transfers';
import { readIncome } from '@/modules/ledger/application/income';
import { readExpenses } from '@/modules/ledger/application/expenses';
import {
  createFamily,
  familyCommand,
  respondFamilyInvitation,
} from '@/modules/workspaces/application/family';
import { invitation, member } from '@/server/db/schema/identity';
import { encryptToken } from '@/server/security/encryption';
async function account(
  headers: Headers,
  scope: string,
  name: string,
  openingBalance: string,
  currency = 'RUB',
) {
  const r = await accountCommand(
    headers,
    { workspaceId: scope, operationKey: randomUUID() },
    { command: 'create', name, type: 'cash', currency, openingBalance },
  );
  if (r.status !== 'success') throw Error('FIXTURE');
  return r.data;
}
async function fixture() {
  const a = await registeredActor();
  const [s] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, a.actorId));
  const source = await account(a.headers, s!.id, 'Личный секретный', '50000'),
    destination = await account(a.headers, s!.id, 'Получатель', '20000');
  return {
    ...a,
    source,
    destination,
    envelope: { workspaceId: s!.id, operationKey: randomUUID() },
    input: {
      sourceWorkspaceId: s!.id,
      destinationWorkspaceId: s!.id,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      debitAmount: '10000',
      creditAmount: '10000',
      financialDate: '2026-10-17',
      sourceDescription: 'Приватный секрет',
      destinationDescription: 'Перевод',
    },
  };
}
test('КУ-004; concurrent retry one effect, immutable pair/rate/audits/versions and zero income/expense', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    createTransfer(f.headers, f.envelope, f.input),
    createTransfer(f.headers, f.envelope, f.input),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe('success');
  if (a.status !== 'success') throw Error('SUCCESS');
  const r = await readAccounts(f.headers, f.envelope.workspaceId);
  expect(r.totals).toEqual([{ currency: 'RUB', amount: '70000.00' }]);
  expect(r.accounts.find((a) => a.id === f.source.id)).toMatchObject({
    balance: '40000.00',
    version: '2',
  });
  expect(r.accounts.find((a) => a.id === f.destination.id)).toMatchObject({
    balance: '30000.00',
    version: '2',
  });
  expect(
    (await readIncome(f.headers, f.envelope.workspaceId, '2026-10')).totals,
  ).toEqual([]);
  expect(
    (await readExpenses(f.headers, f.envelope.workspaceId, '2026-10')).totals,
  ).toEqual([]);
  for (const [table, column, count] of [
    [ledgerLeg, ledgerLeg.actionId, 2],
    [actionRevision, actionRevision.actionId, 1],
    [transferDetail, transferDetail.actionId, 1],
    [scopedAuditEvent, scopedAuditEvent.objectId, 2],
  ] as const)
    expect(
      await db.select().from(table).where(eq(column, a.data.id)),
    ).toHaveLength(count);
  expect(
    (
      await db
        .select()
        .from(transferDetail)
        .where(eq(transferDetail.actionId, a.data.id))
    )[0],
  ).toMatchObject({
    rateNumerator: '10000.00',
    rateDenominator: '10000.00',
    rateDecimal: '1',
  });
  expect(
    (
      await createTransfer(f.headers, f.envelope, {
        ...f.input,
        debitAmount: '1',
        creditAmount: '1',
      })
    ).status,
  ).toBe('conflict');
  expect(
    (
      await createTransfer(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        f.input,
      )
    ).status,
  ).toBe('success');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts.find(
      (a) => a.id === f.source.id,
    )?.balance,
  ).toBe('30000.00');
});
test('real PostgreSQL failure after first leg AND balance write rolls back all; same key retry', async () => {
  const f = await fixture(),
    trigger = `transfer_failure_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${f.destination.id}' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON ledger_leg FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await createTransfer(f.headers, f.envelope, f.input)).status).toBe(
      'unavailable',
    );
    for (const a of [f.source, f.destination])
      expect(
        (
          await db
            .select()
            .from(financialAccount)
            .where(eq(financialAccount.id, a.id))
        )[0],
      ).toMatchObject({ balanceProjection: a.balance, version: 1n });
    expect(
      await db
        .select()
        .from(ledgerLeg)
        .where(eq(ledgerLeg.accountId, f.source.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(financialAction)
        .where(eq(financialAction.creatorId, f.actorId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, f.envelope.operationKey)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(scopedAuditEvent)
        .where(
          and(
            eq(scopedAuditEvent.workspaceId, f.envelope.workspaceId),
            eq(scopedAuditEvent.objectType, 'transfer'),
          ),
        ),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON ledger_leg; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await createTransfer(f.headers, f.envelope, f.input)).status).toBe(
    'success',
  );
});
test('validation, scope spoofing, foreign/archived accounts and missing session have no effect', async () => {
  const f = await fixture(),
    other = await fixture();
  const run = (patch: object = {}, headers = f.headers) =>
    createTransfer(
      headers,
      { ...f.envelope, operationKey: randomUUID() },
      { ...f.input, ...patch },
    );
  for (const patch of [
    { destinationAccountId: f.source.id },
    { debitAmount: '0' },
    { creditAmount: '1' },
    { debitAmount: '1.001', creditAmount: '1.001' },
    { financialDate: '2026-02-30' },
    { currency: 'USD' },
  ])
    expect((await run(patch)).status).toBe('validation');
  for (const patch of [
    { destinationAccountId: other.source.id },
    { destinationWorkspaceId: other.envelope.workspaceId },
    { sourceWorkspaceId: other.envelope.workspaceId },
  ])
    expect((await run(patch)).status).toBe('forbidden');
  expect((await run({}, other.headers)).status).toBe('forbidden');
  expect((await run({}, new Headers())).status).toBe('unauthorized');
  const yen = await account(
    f.headers,
    f.envelope.workspaceId,
    'Иены',
    '0',
    'JPY',
  );
  expect((await run({ destinationAccountId: yen.id })).status).toBe(
    'validation',
  );
  await db
    .update(financialAccount)
    .set({ archivedAt: new Date() })
    .where(eq(financialAccount.id, f.destination.id));
  expect((await run()).status).toBe('forbidden');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts.find(
      (a) => a.id === f.source.id,
    )?.balance,
  ).toBe('50000.00');
});
test('negative warning decline/stale/confirm/replay; opposite concurrent transfers serialize', async () => {
  const f = await fixture(),
    input = { ...f.input, debitAmount: '60000', creditAmount: '60000' };
  const warning = await createTransfer(f.headers, f.envelope, input);
  expect(warning.status).toBe('confirmation_required');
  if (warning.status !== 'confirmation_required') throw Error('WARNING');
  expect(warning.balances).toEqual([
    { accountId: f.source.id, amount: '-10000.00', currency: 'RUB' },
  ]);
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts.find(
      (a) => a.id === f.source.id,
    )?.balance,
  ).toBe('50000.00');
  await createTransfer(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    f.input,
  );
  const stale = await createTransfer(
    f.headers,
    { ...f.envelope, confirmationToken: warning.confirmationToken },
    input,
  );
  expect(stale.status).toBe('confirmation_required');
  if (stale.status !== 'confirmation_required') throw Error('WARNING');
  const e = { ...f.envelope, confirmationToken: stale.confirmationToken };
  const r = await createTransfer(f.headers, e, input);
  expect(r.status).toBe('success');
  expect(await createTransfer(f.headers, e, input)).toEqual(r);
  const g = await fixture();
  const reverse = {
    ...g.input,
    sourceAccountId: g.destination.id,
    destinationAccountId: g.source.id,
  };
  const results = await Promise.all([
    createTransfer(g.headers, g.envelope, g.input),
    createTransfer(
      g.headers,
      { ...g.envelope, operationKey: randomUUID() },
      reverse,
    ),
  ]);
  expect(results.map((r) => r.status)).toEqual(['success', 'success']);
  expect(
    (await readAccounts(g.headers, g.envelope.workspaceId)).accounts.find(
      (a) => a.id === g.source.id,
    )?.balance,
  ).toBe('50000.00');
});
test('personal↔family: actor both sides, family projection/audit privacy, revoke denies retry, deleted denies writes', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const family = await createFamily(
    owner.headers,
    { name: 'Семья', timezone: 'Europe/Moscow', operationKey: randomUUID() },
    mockMail,
  );
  if (family.status !== 'success') throw Error('FAMILY');
  const fe = {
    workspaceId: family.data.id,
    operationKey: randomUUID(),
    expectedVersion: family.data.version,
  };
  await familyCommand(
    owner.headers,
    fe,
    { command: 'invite', email: guest.email },
    mockMail,
  );
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, family.data.organizationId));
  expect(
    (
      await respondFamilyInvitation(guest.headers, {
        secret: encryptToken(inv!.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('success');
  const shared = await account(
    owner.headers,
    family.data.id,
    'Семейный',
    '20000',
  );
  const input = {
    ...guest.input,
    destinationWorkspaceId: family.data.id,
    destinationAccountId: shared.id,
  };
  expect(
    (
      await createTransfer(
        owner.headers,
        { workspaceId: family.data.id, operationKey: randomUUID() },
        input,
      )
    ).status,
  ).toBe('forbidden');
  const result = await createTransfer(guest.headers, guest.envelope, input);
  expect(result.status).toBe('success');
  const rows = await readTransfers(owner.headers, family.data.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.legs).toHaveLength(1);
  expect(rows[0]?.legs[0]).toMatchObject({
    accountId: shared.id,
    role: 'transfer_in',
    amount: '10000.00',
    description: 'Перевод',
  });
  const familyAudit = await db
    .select()
    .from(scopedAuditEvent)
    .where(
      and(
        eq(scopedAuditEvent.workspaceId, family.data.id),
        eq(scopedAuditEvent.objectType, 'transfer'),
      ),
    );
  for (const value of [
    rows,
    familyAudit,
    await readAccounts(owner.headers, family.data.id),
  ]) {
    expect(JSON.stringify(value)).not.toContain(guest.source.id);
    expect(JSON.stringify(value)).not.toContain('Приватный секрет');
    expect(JSON.stringify(value)).not.toContain('Личный секретный');
  }
  const reverse = {
    ...input,
    sourceWorkspaceId: family.data.id,
    destinationWorkspaceId: guest.envelope.workspaceId,
    sourceAccountId: shared.id,
    destinationAccountId: guest.source.id,
    sourceDescription: 'Из семьи',
    destinationDescription: 'Личный возврат',
  };
  expect(
    (
      await createTransfer(
        guest.headers,
        { workspaceId: family.data.id, operationKey: randomUUID() },
        reverse,
      )
    ).status,
  ).toBe('success');
  const [m] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, family.data.organizationId),
        eq(member.userId, guest.actorId),
      ),
    );
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...fe, operationKey: randomUUID() },
        { command: 'remove', memberId: m!.id },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect(
    (await createTransfer(guest.headers, guest.envelope, input)).status,
  ).toBe('forbidden');
  await expect(readTransfers(guest.headers, family.data.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (
      await readTransfers(guest.headers, guest.envelope.workspaceId)
    )[0]?.legs.every((l) => l.accountId === guest.source.id),
  ).toBe(true);
  expect(
    (await readTransferOptions(guest.headers, guest.envelope.workspaceId)).some(
      (a) => a.workspaceId === family.data.id,
    ),
  ).toBe(false);
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...fe, operationKey: randomUUID() },
        { command: 'delete', explicitConfirmation: true },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await createTransfer(
        owner.headers,
        { ...owner.envelope, operationKey: randomUUID() },
        {
          ...owner.input,
          destinationWorkspaceId: family.data.id,
          destinationAccountId: shared.id,
        },
      )
    ).status,
  ).toBe('forbidden');
});

test('family internal transfer by member and revoke race; family↔family forbidden', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const f = await createFamily(
    owner.headers,
    { name: 'Гонка', timezone: 'UTC', operationKey: randomUUID() },
    mockMail,
  );
  if (f.status !== 'success') throw Error('FIXTURE');
  const envelope = {
    workspaceId: f.data.id,
    operationKey: randomUUID(),
    expectedVersion: '1',
  };
  await familyCommand(
    owner.headers,
    envelope,
    { command: 'invite', email: guest.email },
    mockMail,
  );
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, f.data.organizationId));
  await respondFamilyInvitation(guest.headers, {
    secret: encryptToken(inv!.id, 'invitation-link'),
    decision: 'accept',
    operationKey: randomUUID(),
  });
  const source = await account(owner.headers, f.data.id, 'Источник', '50000'),
    destination = await account(owner.headers, f.data.id, 'Приёмник', '20000');
  const internal = {
    ...guest.input,
    sourceWorkspaceId: f.data.id,
    destinationWorkspaceId: f.data.id,
    sourceAccountId: source.id,
    destinationAccountId: destination.id,
  };
  expect(
    (
      await createTransfer(
        guest.headers,
        { ...envelope, operationKey: randomUUID() },
        internal,
      )
    ).status,
  ).toBe('success');
  const other = await createFamily(
    owner.headers,
    { name: 'Вторая', timezone: 'UTC', operationKey: randomUUID() },
    mockMail,
  );
  if (other.status !== 'success') throw Error('FIXTURE');
  const otherAccount = await account(
    owner.headers,
    other.data.id,
    'Другой',
    '0',
  );
  expect(
    (
      await createTransfer(
        owner.headers,
        { ...envelope, operationKey: randomUUID() },
        {
          ...internal,
          destinationWorkspaceId: other.data.id,
          destinationAccountId: otherAccount.id,
        },
      )
    ).status,
  ).toBe('forbidden');
  const [m] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, f.data.organizationId),
        eq(member.userId, guest.actorId),
      ),
    );
  const e = { ...guest.envelope, operationKey: randomUUID() },
    input = {
      ...guest.input,
      destinationWorkspaceId: f.data.id,
      destinationAccountId: destination.id,
    };
  const [transfer, removal] = await Promise.all([
    createTransfer(guest.headers, e, input),
    familyCommand(
      owner.headers,
      { ...envelope, operationKey: randomUUID() },
      { command: 'remove', memberId: m!.id },
      mockMail,
    ),
  ]);
  expect(removal.status).toBe('success');
  expect(['success', 'forbidden']).toContain(transfer.status);
  expect((await createTransfer(guest.headers, e, input)).status).toBe(
    'forbidden',
  );
  const a = (
    await readAccounts(guest.headers, guest.envelope.workspaceId)
  ).accounts.find((a) => a.id === guest.source.id)!;
  expect(a.balance).toBe(
    transfer.status === 'success' ? '40000.00' : '50000.00',
  );
  const b = (await readAccounts(owner.headers, f.data.id)).accounts.find(
    (a) => a.id === destination.id,
  )!;
  expect(b.balance).toBe(
    transfer.status === 'success' ? '40000.00' : '30000.00',
  );
});
