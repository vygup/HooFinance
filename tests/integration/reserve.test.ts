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
import { goal, reserveSettings } from '@/server/db/schema/reserve';
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
test('КУ-006/007: atomic save, replay, uniqueness, audit, edit/zero/restore/archive without changing money', async () => {
  const f = await fixture();
  expect((await readGoals(f.headers, f.envelope.workspaceId)).goals).toEqual(
    [],
  );
  const before = await readAccounts(f.headers, f.envelope.workspaceId);
  const [a, b] = await Promise.all([
    goalCommand(f.headers, f.envelope, f.input),
    goalCommand(f.headers, f.envelope, f.input),
  ]);
  expect(a).toEqual(b);
  if (a.status !== 'success') throw Error(a.status);
  expect(a.data.progress).toMatchObject({
    actual: '220000.00',
    target: '600000.00',
    remaining: '380000.00',
    percent: '36.67',
    coverage: '4.4',
  });
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        f.input,
      )
    ).status,
  ).toBe('conflict');
  let version = '1';
  for (const monthlyAmount of ['55000', '0', '55000']) {
    const r = await goalCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID(), expectedVersion: version },
      { ...f.input, command: 'update', id: a.data.id, monthlyAmount },
    );
    if (r.status !== 'success') throw Error(r.status);
    version = r.data.version;
    expect(r.data.progress).toMatchObject(
      monthlyAmount === '0'
        ? {
            target: '0.00',
            remaining: '0.00',
            status: 'no_obligation',
            percent: null,
            coverage: null,
            reached: null,
          }
        : { target: '660000.00', coverage: '4' },
    );
  }
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
        { ...f.input, command: 'update', id: a.data.id },
      )
    ).status,
  ).toBe('conflict');
  const archive = await goalCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID(), expectedVersion: version },
    { command: 'archive', id: a.data.id, explicitConfirmation: true },
  );
  expect(archive.status).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.archived,
  ).toBe(true);
  expect(await readAccounts(f.headers, f.envelope.workspaceId)).toEqual(before);
  expect(
    await db
      .select()
      .from(scopedAuditEvent)
      .where(eq(scopedAuditEvent.objectId, a.data.id)),
  ).toHaveLength(5);
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        {
          command: 'create',
          type: 'ordinary',
          name: 'Обычная',
          accountId: f.account.id,
          currency: 'RUB',
          ordinaryTarget: '100000',
        },
      )
    ).status,
  ).toBe('success');
});
test('unauthorized, foreign scope/account/currency and malformed input do not write', async () => {
  const f = await fixture(),
    other = await fixture();
  expect((await goalCommand(new Headers(), f.envelope, f.input)).status).toBe(
    'unauthorized',
  );
  expect((await goalCommand(other.headers, f.envelope, f.input)).status).toBe(
    'forbidden',
  );
  expect(
    (
      await goalCommand(f.headers, f.envelope, {
        ...f.input,
        accountId: other.account.id,
      })
    ).status,
  ).toBe('forbidden');
  expect(
    (await goalCommand(f.headers, f.envelope, { ...f.input, currency: 'USD' }))
      .status,
  ).toBe('forbidden');
  expect(
    (
      await goalCommand(f.headers, f.envelope, {
        ...f.input,
        monthlyAmount: '-1',
      })
    ).status,
  ).toBe('validation');
  await expect(
    readGoals(other.headers, f.envelope.workspaceId),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    await db
      .select()
      .from(goal)
      .where(eq(goal.workspaceId, f.envelope.workspaceId)),
  ).toHaveLength(0);
});
test('audit failure rolls back goal/settings/receipt; DB enforces scoped currency/one active goal/reserve subtype/money', async () => {
  const f = await fixture();
  const trigger = `goal_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id='${f.envelope.workspaceId}' AND NEW.object_type='goal' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await goalCommand(f.headers, f.envelope, f.input)).status).toBe(
      'unavailable',
    );
    expect(
      await db
        .select()
        .from(goal)
        .where(eq(goal.workspaceId, f.envelope.workspaceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(reserveSettings)
        .where(eq(reserveSettings.workspaceId, f.envelope.workspaceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, f.envelope.operationKey)),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  const values = {
    workspaceId: f.envelope.workspaceId,
    name: 'Цель',
    type: 'ordinary',
    currency: 'RUB',
    accountId: f.account.id,
    ordinaryTarget: '100000',
  };
  for (const patch of [
    { currency: 'USD' },
    { ordinaryTarget: 'NaN' },
    { ordinaryTarget: '0' },
    { ordinaryTarget: '1.001' },
    { type: 'reserve', ordinaryTarget: null },
  ])
    await expect(
      db.insert(goal).values({ ...values, ...patch }),
    ).rejects.toThrow();
  const r = await goalCommand(f.headers, f.envelope, f.input);
  if (r.status !== 'success') throw Error(r.status);
  await expect(db.insert(goal).values(values)).rejects.toThrow();
  for (const patch of [
    { monthlyAmount: '-1' },
    { monthlyAmount: 'NaN' },
    { monthlyAmount: '1.001' },
    { coverageMonths: '0' },
    { coverageMonths: '1.5' },
    { linkedObligationId: randomUUID() },
  ])
    await expect(
      db
        .update(reserveSettings)
        .set(patch)
        .where(eq(reserveSettings.goalId, r.data.id)),
    ).rejects.toThrow();
});

test('derived progress follows actual ledger balance, reached is reversible, no-obligation restores after deficit', async () => {
  const f = await fixture();
  const r = await goalCommand(f.headers, f.envelope, f.input);
  if (r.status !== 'success') throw Error(r.status);
  const { createIncome } = await import('@/modules/ledger/application/income');
  const { createExpense } =
    await import('@/modules/ledger/application/expenses');
  const envelope = () => ({ ...f.envelope, operationKey: randomUUID() });
  expect(
    (
      await createIncome(f.headers, envelope(), {
        accountId: f.account.id,
        category: { name: 'Поступление' },
        amount: '380000',
        financialDate: '2026-10-17',
      })
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.progress,
  ).toMatchObject({ actual: '600000.00', reached: true, status: 'reached' });
  expect(
    (
      await createExpense(f.headers, envelope(), {
        accountId: f.account.id,
        category: { name: 'Списание' },
        amount: '1',
        financialDate: '2026-10-17',
      })
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.progress,
  ).toMatchObject({
    actual: '599999.00',
    remaining: '1.00',
    reached: false,
    status: 'in_progress',
  });
  const e = envelope(),
    input = {
      accountId: f.account.id,
      category: { name: 'Дефицит' },
      amount: '604999',
      financialDate: '2026-10-17',
    };
  const warning = await createExpense(f.headers, e, input);
  if (warning.status !== 'confirmation_required') throw Error(warning.status);
  expect(
    (
      await createExpense(
        f.headers,
        { ...e, confirmationToken: warning.confirmationToken },
        input,
      )
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.progress,
  ).toMatchObject({
    actual: '-5000.00',
    remaining: '605000.00',
    percent: null,
    coverage: null,
    status: 'deficit',
  });
  const zero = await goalCommand(
    f.headers,
    { ...envelope(), expectedVersion: '1' },
    { ...f.input, command: 'update', id: r.data.id, monthlyAmount: '0' },
  );
  expect(zero.status).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.progress,
  ).toMatchObject({
    status: 'no_obligation',
    deficit: true,
    remaining: '0.00',
    reached: null,
  });
  expect(
    (
      await goalCommand(
        f.headers,
        { ...envelope(), expectedVersion: '2' },
        { ...f.input, command: 'update', id: r.data.id },
      )
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.envelope.workspaceId)).goals[0]?.progress
      .status,
  ).toBe('deficit');
});
test('family member commands serialize, revoked access denies read/replay and deleted family denies writes', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { member } = await import('@/server/db/schema/identity');
  const family = await createFamily(
    owner.headers,
    {
      name: 'Семейный резерв',
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
  const envelope = { workspaceId: family.data.id, operationKey: randomUUID() };
  const a = await accountCommand(owner.headers, envelope, {
    command: 'create',
    name: 'Общий',
    type: 'reserve',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (a.status !== 'success') throw Error(a.status);
  const e = { ...envelope, operationKey: randomUUID() },
    input = { ...owner.input, accountId: a.data.id };
  const result = await goalCommand(guest.headers, e, input);
  if (result.status !== 'success') throw Error(result.status);
  const edits = await Promise.all(
    ['55000', '60000'].map((monthlyAmount) =>
      goalCommand(
        guest.headers,
        { ...e, operationKey: randomUUID(), expectedVersion: '1' },
        { ...input, command: 'update', id: result.data.id, monthlyAmount },
      ),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  expect(
    (await readGoals(owner.headers, family.data.id)).goals[0]?.version,
  ).toBe('2');
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
  expect((await goalCommand(guest.headers, e, input)).status).toBe('forbidden');
  await expect(readGoals(guest.headers, family.data.id)).rejects.toThrow(
    'FORBIDDEN',
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
      await goalCommand(
        owner.headers,
        { ...e, operationKey: randomUUID(), expectedVersion: '2' },
        { command: 'archive', id: result.data.id, explicitConfirmation: true },
      )
    ).status,
  ).toBe('forbidden');
});
