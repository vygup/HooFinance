import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { readGoalFunding } from '@/modules/goals/application/goal-funding';
import { registeredActor, integrationDb as db } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { commandReceipt, scopedAuditEvent } from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import { readMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import { withdrawReserve } from '@/modules/goals/application/reserve-withdrawal';
async function fixture(sourceBalance = '100000') {
  const actor = await registeredActor();
  const [w] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const workspaceId = w!.id;
  const envelope = () => ({ workspaceId, operationKey: randomUUID() });
  const make = async (
    name: string,
    openingBalance: string,
    type = 'bank_card',
  ) => {
    const a = await accountCommand(actor.headers, envelope(), {
      command: 'create',
      name,
      type,
      currency: 'RUB',
      openingBalance,
    });
    if (a.status !== 'success') throw Error(a.status);
    return a.data;
  };
  const source = await make('Банк', sourceBalance),
    destination = await make('Подушка', '600000', 'accumulation');
  const g = await goalCommand(actor.headers, envelope(), {
    command: 'create',
    type: 'reserve',
    name: 'Ипотека',
    accountId: destination.id,
    currency: 'RUB',
    monthlyAmount: '50000',
    coverageMonths: '12',
  });
  if (g.status !== 'success') throw Error(g.status);
  return {
    ...actor,
    workspaceId,
    source,
    destination,
    goal: g.data,
    envelope,
    input: {
      goalId: g.data.id,
      sourceWorkspaceId: workspaceId,
      destinationWorkspaceId: workspaceId,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      debitAmount: '20000',
      creditAmount: '20000',
      financialDate: '2026-10-17',
    },
  };
}

test('expense/transfer withdrawal recalculates reached, replay, audit and conserved totals', async () => {
  for (const kind of ['expense', 'transfer'] as const) {
    const f = await fixture('0'),
      e = { ...f.envelope(), expectedVersion: '1' };
    const input =
      kind === 'expense'
        ? {
            kind,
            goalId: f.goal.id,
            accountId: f.destination.id,
            amount: '50000',
            category: { name: 'Платёж' },
            financialDate: '2026-10-17',
          }
        : {
            ...f.input,
            kind,
            sourceAccountId: f.destination.id,
            destinationAccountId: f.source.id,
            debitAmount: '50000',
            creditAmount: '50000',
          };
    const [a, b] = await Promise.all([
      withdrawReserve(f.headers, e, input),
      withdrawReserve(f.headers, e, input),
    ]);
    expect(a).toEqual(b);
    if (a.status !== 'success') throw Error(a.status);
    expect(a.data.goal.progress).toMatchObject({
      actual: '550000.00',
      remaining: '50000.00',
      coverage: '11',
      reached: false,
    });
    expect(a.data.account.history[0]?.role).toBe(
      kind === 'expense' ? 'expense' : 'transfer_out',
    );
    expect((await readAccounts(f.headers, f.workspaceId)).totals).toEqual([
      {
        currency: 'RUB',
        amount: kind === 'expense' ? '550000.00' : '600000.00',
      },
    ]);
    expect(
      (await readMonthlyBudget(f.headers, f.workspaceId, '2026-10', 'RUB'))
        .summary.actual,
    ).toBe(kind === 'expense' ? '50000.00' : '0.00');
    const id = 'transfer' in a.data ? a.data.transfer.id : a.data.expense.id;
    expect(
      await db
        .select()
        .from(scopedAuditEvent)
        .where(eq(scopedAuditEvent.objectId, id)),
    ).toHaveLength(kind === 'expense' ? 1 : 2);
    expect(
      (
        await withdrawReserve(f.headers, e, {
          ...input,
          financialDate: '2026-10-18',
        })
      ).status,
    ).toBe('conflict');
  }
});
test('permission, stale/missing version and wrong linked account deny withdrawal; negative confirmation gives deficit', async () => {
  const f = await fixture(),
    other = await fixture();
  const input = {
      kind: 'expense',
      goalId: f.goal.id,
      accountId: f.destination.id,
      amount: '605000',
      category: { name: 'Платёж' },
      financialDate: '2026-10-17',
    },
    e = { ...f.envelope(), expectedVersion: '1' };
  expect((await withdrawReserve(new Headers(), e, input)).status).toBe(
    'unauthorized',
  );
  expect((await withdrawReserve(other.headers, e, input)).status).toBe(
    'forbidden',
  );
  expect(
    (await withdrawReserve(f.headers, { ...e, expectedVersion: '2' }, input))
      .status,
  ).toBe('conflict');
  expect((await withdrawReserve(f.headers, f.envelope(), input)).status).toBe(
    'validation',
  );
  expect(
    (await withdrawReserve(f.headers, e, { ...input, accountId: f.source.id }))
      .status,
  ).toBe('forbidden');
  expect(
    (await withdrawReserve(f.headers, e, { ...input, goalId: other.goal.id }))
      .status,
  ).toBe('forbidden');
  const warning = await withdrawReserve(f.headers, e, input);
  if (warning.status !== 'confirmation_required') throw Error(warning.status);
  expect(
    (await readGoals(f.headers, f.workspaceId)).goals[0]?.progress.actual,
  ).toBe('600000.00');
  const r = await withdrawReserve(
    f.headers,
    { ...e, confirmationToken: warning.confirmationToken },
    input,
  );
  if (r.status !== 'success') throw Error(r.status);
  expect(r.data.goal.progress).toMatchObject({
    actual: '-5000.00',
    remaining: '605000.00',
    percent: null,
    coverage: null,
    status: 'deficit',
    reached: false,
  });
});
test('failed destination leg rolls back reserve, balances, audit and receipt; retry succeeds', async () => {
  const f = await fixture(),
    before = await readAccounts(f.headers, f.workspaceId),
    trigger = `withdraw_fail_${randomUUID().replaceAll('-', '')}`;
  const input = {
      ...f.input,
      kind: 'transfer',
      sourceAccountId: f.destination.id,
      destinationAccountId: f.source.id,
    },
    e = { ...f.envelope(), expectedVersion: '1' };
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${f.source.id}' AND NEW.role='transfer_in' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON ledger_leg FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await withdrawReserve(f.headers, e, input)).status).toBe(
      'unavailable',
    );
    expect(await readAccounts(f.headers, f.workspaceId)).toEqual(before);
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, e.operationKey)),
    ).toHaveLength(0);
    expect(
      (await readGoals(f.headers, f.workspaceId)).goals[0]?.progress.reached,
    ).toBe(true);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON ledger_leg; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await withdrawReserve(f.headers, e, input)).status).toBe('success');
});

test('zero obligation preserves deficit; archived reserve rejects new withdrawal', async () => {
  const f = await fixture();
  const updated = await goalCommand(
    f.headers,
    { ...f.envelope(), expectedVersion: '1' },
    {
      command: 'update',
      id: f.goal.id,
      type: 'reserve',
      name: 'Резерв',
      accountId: f.destination.id,
      currency: 'RUB',
      monthlyAmount: '0',
      coverageMonths: '12',
    },
  );
  expect(updated.status).toBe('success');
  const input = {
      kind: 'expense',
      goalId: f.goal.id,
      accountId: f.destination.id,
      amount: '605000',
      category: { name: 'Платёж' },
      financialDate: '2026-10-17',
    },
    e = { ...f.envelope(), expectedVersion: '2' };
  const warning = await withdrawReserve(f.headers, e, input);
  if (warning.status !== 'confirmation_required') throw Error(warning.status);
  const r = await withdrawReserve(
    f.headers,
    { ...e, confirmationToken: warning.confirmationToken },
    input,
  );
  if (r.status !== 'success') throw Error(r.status);
  expect(r.data.goal.progress).toMatchObject({
    actual: '-5000.00',
    remaining: '0.00',
    percent: null,
    coverage: null,
    reached: null,
    status: 'no_obligation',
    deficit: true,
  });
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope(), expectedVersion: '2' },
        { command: 'archive', id: f.goal.id, explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await withdrawReserve(
        f.headers,
        { ...f.envelope(), expectedVersion: '3' },
        { ...input, amount: '1' },
      )
    ).status,
  ).toBe('forbidden');
});

test('family reserve withdrawal to own personal account returns only family projection; revoked membership denies replay/read', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { member } = await import('@/server/db/schema/identity');
  const family = await createFamily(
    owner.headers,
    {
      name: 'Цель семьи',
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
    name: 'Общая подушка',
    type: 'accumulation',
    currency: 'RUB',
    openingBalance: '600000',
  });
  if (a.status !== 'success') throw Error(a.status);
  const g = await goalCommand(
    owner.headers,
    { ...e, operationKey: randomUUID() },
    {
      command: 'create',
      type: 'reserve',
      name: 'Общая цель',
      accountId: a.data.id,
      currency: 'RUB',
      monthlyAmount: '50000',
      coverageMonths: '12',
    },
  );
  if (g.status !== 'success') throw Error(g.status);
  const envelope = { ...e, operationKey: randomUUID(), expectedVersion: '1' },
    input = {
      ...guest.input,
      kind: 'transfer',
      goalId: g.data.id,
      sourceWorkspaceId: family.data.id,
      destinationWorkspaceId: guest.workspaceId,
      sourceAccountId: a.data.id,
      destinationAccountId: guest.source.id,
      sourceDescription: 'Общее списание',
      destinationDescription: 'Личное описание получателя',
    };
  const r = await withdrawReserve(guest.headers, envelope, input);
  expect(r.status).toBe('success');
  if (r.status !== 'success') throw Error(r.status);
  expect(r.data.goal.progress.actual).toBe('580000.00');
  if (!('transfer' in r.data)) throw Error('EXPECTED_TRANSFER');
  expect(r.data.transfer.legs).toHaveLength(1);
  expect(r.data.account.history[0]?.description).toBe('Общее списание');
  expect(JSON.stringify(r.data)).not.toContain(guest.source.id);
  expect(JSON.stringify(r.data)).not.toContain('Личное описание получателя');
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
  expect((await withdrawReserve(guest.headers, envelope, input)).status).toBe(
    'forbidden',
  );
  await expect(
    readGoalFunding(guest.headers, family.data.id, { goalId: g.data.id }),
  ).rejects.toThrow('FORBIDDEN');
});
