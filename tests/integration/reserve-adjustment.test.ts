import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { registeredActor, integrationDb as db } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { commandReceipt, scopedAuditEvent } from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const envelope = { workspaceId: scope!.id, operationKey: randomUUID() };
  const result = await accountCommand(actor.headers, envelope, {
    command: 'create',
    name: 'Подушка',
    type: 'accumulation',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (result.status !== 'success') throw Error(result.status);
  return {
    ...actor,
    envelope: { ...envelope, operationKey: randomUUID() },
    account: result.data,
    input: {
      command: 'create' as const,
      type: 'reserve' as const,
      name: 'Ипотечная подушка',
      accountId: result.data.id,
      currency: 'RUB',
      monthlyAmount: '50000',
      coverageMonths: '12',
    },
  };
}

import { adjustReserve } from '@/modules/goals/application/reserve-adjustment';
async function reserveFixture() {
  const f = await fixture();
  const created = await goalCommand(f.headers, f.envelope, f.input);
  if (created.status !== 'success') throw Error(created.status);
  return {
    ...f,
    reserve: created.data,
    adjustment: {
      command: 'adjustReserve' as const,
      goalId: created.data.id,
      monthlyAmount: '55000',
      coverageMonths: '12',
    },
    edit: { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
  };
}
test('КУ-009: settings only, concurrent replay, zero/restore/months, audit and version', async () => {
  const f = await reserveFixture();
  const before = await readAccounts(f.headers, f.envelope.workspaceId);
  const [a, b] = await Promise.all([
    adjustReserve(f.headers, f.edit, f.adjustment),
    adjustReserve(f.headers, f.edit, f.adjustment),
  ]);
  expect(a).toEqual(b);
  if (a.status !== 'success') throw Error(a.status);
  expect(a.data).toMatchObject({
    accountId: f.account.id,
    version: '2',
    progress: {
      actual: '220000.00',
      target: '660000.00',
      remaining: '440000.00',
      coverage: '4',
    },
  });
  expect(
    (
      await adjustReserve(f.headers, f.edit, {
        ...f.adjustment,
        monthlyAmount: '60000',
      })
    ).status,
  ).toBe('conflict');
  let version = '2';
  for (const monthlyAmount of ['0', '55000']) {
    const r = await adjustReserve(
      f.headers,
      { ...f.edit, operationKey: randomUUID(), expectedVersion: version },
      { ...f.adjustment, monthlyAmount },
    );
    if (r.status !== 'success') throw Error(r.status);
    version = r.data.version;
    expect(r.data.progress).toMatchObject(
      monthlyAmount === '0'
        ? {
            status: 'no_obligation',
            remaining: '0.00',
            percent: null,
            coverage: null,
            reached: null,
          }
        : { target: '660000.00', remaining: '440000.00', coverage: '4' },
    );
  }
  const r = await adjustReserve(
    f.headers,
    { ...f.edit, operationKey: randomUUID(), expectedVersion: version },
    { ...f.adjustment, coverageMonths: '6' },
  );
  if (r.status !== 'success') throw Error(r.status);
  expect(r.data.progress.target).toBe('330000.00');
  expect(await readAccounts(f.headers, f.envelope.workspaceId)).toEqual(before);
  const audit = await db
    .select()
    .from(scopedAuditEvent)
    .where(eq(scopedAuditEvent.objectId, f.reserve.id));
  expect(audit).toHaveLength(5);
  expect(audit.find((x) => x.revisionNo === 2)).toMatchObject({
    beforeScope: { monthlyAmount: '50000.00' },
    afterScope: { monthlyAmount: '55000.00' },
  });
});
test('authorization, foreign goal, stale/missing version, invalid scale and archived/ordinary goals', async () => {
  const f = await reserveFixture(),
    other = await reserveFixture();
  expect(
    (await adjustReserve(new Headers(), f.edit, f.adjustment)).status,
  ).toBe('unauthorized');
  expect(
    (await adjustReserve(other.headers, f.edit, f.adjustment)).status,
  ).toBe('forbidden');
  expect(
    (
      await adjustReserve(f.headers, f.edit, {
        ...f.adjustment,
        goalId: other.reserve.id,
      })
    ).status,
  ).toBe('forbidden');
  for (const expectedVersion of [undefined, '2'])
    expect(
      (
        await adjustReserve(
          f.headers,
          { ...f.edit, expectedVersion },
          f.adjustment,
        )
      ).status,
    ).toBe('conflict');
  for (const monthlyAmount of ['-1', 'NaN', '1.001'])
    expect(
      (
        await adjustReserve(f.headers, f.edit, {
          ...f.adjustment,
          monthlyAmount,
        })
      ).status,
    ).toBe('validation');
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.edit, operationKey: randomUUID() },
        { command: 'archive', id: f.reserve.id, explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await adjustReserve(
        f.headers,
        { ...f.edit, expectedVersion: '2' },
        f.adjustment,
      )
    ).status,
  ).toBe('forbidden');
  const ordinary = await goalCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    {
      command: 'create',
      type: 'ordinary',
      name: 'Цель',
      accountId: f.account.id,
      currency: 'RUB',
      ordinaryTarget: '100000',
    },
  );
  if (ordinary.status !== 'success') throw Error(ordinary.status);
  expect(
    (
      await adjustReserve(f.headers, f.edit, {
        ...f.adjustment,
        goalId: ordinary.data.id,
      })
    ).status,
  ).toBe('forbidden');
});
test('audit failure rolls back settings, version, receipt and account; retry succeeds', async () => {
  const f = await reserveFixture();
  const before = await readGoals(f.headers, f.envelope.workspaceId);
  const accounts = await readAccounts(f.headers, f.envelope.workspaceId);
  const trigger = `adjust_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${f.reserve.id}' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await adjustReserve(f.headers, f.edit, f.adjustment)).status).toBe(
      'unavailable',
    );
    expect(await readGoals(f.headers, f.envelope.workspaceId)).toEqual(before);
    expect(await readAccounts(f.headers, f.envelope.workspaceId)).toEqual(
      accounts,
    );
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, f.edit.operationKey)),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await adjustReserve(f.headers, f.edit, f.adjustment)).status).toBe(
    'success',
  );
});
test('family member edits, concurrent versions, revoked replay and deleted family', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { member } = await import('@/server/db/schema/identity');
  const family = await createFamily(
    owner.headers,
    {
      name: 'Резерв семьи',
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    },
    mockMail,
  );
  if (family.status !== 'success') throw Error(family.status);
  const [membership] = await db
    .insert(member)
    .values({
      id: randomUUID(),
      organizationId: family.data.organizationId,
      userId: guest.actorId,
      role: 'member',
      createdAt: new Date(),
    })
    .returning();
  const e = { workspaceId: family.data.id, operationKey: randomUUID() };
  const a = await accountCommand(owner.headers, e, {
    command: 'create',
    name: 'Общий резерв',
    type: 'reserve',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (a.status !== 'success') throw Error(a.status);
  const g = await goalCommand(
    owner.headers,
    { ...e, operationKey: randomUUID() },
    { ...owner.input, accountId: a.data.id },
  );
  if (g.status !== 'success') throw Error(g.status);
  const input = {
    command: 'adjustReserve',
    goalId: g.data.id,
    monthlyAmount: '55000',
    coverageMonths: '12',
  };
  const edit = { ...e, operationKey: randomUUID(), expectedVersion: '1' };
  const results = await Promise.all([
    adjustReserve(guest.headers, edit, input),
    adjustReserve(
      owner.headers,
      { ...edit, operationKey: randomUUID() },
      { ...input, monthlyAmount: '60000' },
    ),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  const retry =
    results[0]!.status === 'success'
      ? edit
      : { ...edit, operationKey: randomUUID(), expectedVersion: '2' };
  if (results[0]!.status !== 'success')
    expect((await adjustReserve(guest.headers, retry, input)).status).toBe(
      'success',
    );
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...e,
          operationKey: randomUUID(),
          expectedVersion: family.data.version,
        },
        { command: 'remove', memberId: membership!.id },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect((await adjustReserve(guest.headers, retry, input)).status).toBe(
    'forbidden',
  );
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...e,
          operationKey: randomUUID(),
          expectedVersion: family.data.version,
        },
        { command: 'delete', explicitConfirmation: true },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await adjustReserve(
        owner.headers,
        { ...edit, operationKey: randomUUID(), expectedVersion: '2' },
        input,
      )
    ).status,
  ).toBe('forbidden');
});
