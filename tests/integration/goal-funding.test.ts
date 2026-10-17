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
import {
  ledgerLeg,
  commandReceipt,
  scopedAuditEvent,
} from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import {
  fundGoal,
  readGoalFunding,
} from '@/modules/goals/application/goal-funding';
import { readMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import { readIncome } from '@/modules/ledger/application/income';
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
    destination = await make('Подушка', '220000', 'accumulation');
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
test('goal funding commits one transfer, concurrent replay preserves progress; exact goal/account/history views and no income/expense fact', async () => {
  const f = await fixture();
  const e = { ...f.envelope(), expectedVersion: f.goal.version };
  const [a, b] = await Promise.all([
    fundGoal(f.headers, e, f.input),
    fundGoal(f.headers, e, f.input),
  ]);
  expect(a).toEqual(b);
  if (a.status !== 'success') throw Error(a.status);
  expect(a.data.goal.progress).toMatchObject({
    actual: '240000.00',
    remaining: '360000.00',
    percent: '40.00',
    coverage: '4.8',
  });
  expect(a.data.account.balance).toBe('240000.00');
  expect(a.data.account.history).toMatchObject([
    { role: 'transfer_in', amount: '20000.00' },
  ]);
  expect((await readAccounts(f.headers, f.workspaceId)).totals).toEqual([
    { currency: 'RUB', amount: '320000.00' },
  ]);
  expect(
    (await readMonthlyBudget(f.headers, f.workspaceId, '2026-10', 'RUB'))
      .summary.actual,
  ).toBe('0.00');
  expect(
    (await readIncome(f.headers, f.workspaceId, '2026-10')).totals,
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.actionId, a.data.transfer.id)),
  ).toHaveLength(2);
  expect(
    await db
      .select()
      .from(scopedAuditEvent)
      .where(eq(scopedAuditEvent.objectId, a.data.transfer.id)),
  ).toHaveLength(2);
  expect(
    (
      await fundGoal(f.headers, e, {
        ...f.input,
        debitAmount: '1',
        creditAmount: '1',
      })
    ).status,
  ).toBe('conflict');
  expect(
    (
      await fundGoal(
        f.headers,
        { ...f.envelope(), expectedVersion: '1' },
        f.input,
      )
    ).status,
  ).toBe('success');
  expect(
    (await readGoalFunding(f.headers, f.workspaceId, { goalId: f.goal.id }))
      .goal.progress.actual,
  ).toBe('260000.00');
});
test('forbidden scopes/goal/account, archived goal, stale plan, missing version, invalid amounts never change funds', async () => {
  const f = await fixture(),
    other = await fixture();
  const run = (
    input: unknown,
    headers = f.headers,
    expectedVersion: string | undefined = '1',
  ) => fundGoal(headers, { ...f.envelope(), expectedVersion }, input);
  expect((await run(f.input, new Headers())).status).toBe('unauthorized');
  expect((await run(f.input, other.headers)).status).toBe('forbidden');
  for (const patch of [
    { goalId: other.goal.id },
    { destinationAccountId: f.source.id, sourceAccountId: f.destination.id },
    { destinationWorkspaceId: other.workspaceId },
    { sourceAccountId: other.source.id },
  ])
    expect((await run({ ...f.input, ...patch })).status).toBe('forbidden');
  expect(
    (await run({ ...f.input, debitAmount: '1.001', creditAmount: '1.001' }))
      .status,
  ).toBe('validation');
  expect((await fundGoal(f.headers, f.envelope(), f.input)).status).toBe(
    'validation',
  );
  await expect(
    readGoalFunding(other.headers, f.workspaceId, { goalId: f.goal.id }),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope(), expectedVersion: '1' },
        {
          command: 'update',
          id: f.goal.id,
          type: 'reserve',
          name: 'Изменено',
          accountId: f.destination.id,
          currency: 'RUB',
          monthlyAmount: '55000',
          coverageMonths: '12',
        },
      )
    ).status,
  ).toBe('success');
  expect((await run(f.input)).status).toBe('conflict');
  expect(
    (
      await goalCommand(
        f.headers,
        { ...f.envelope(), expectedVersion: '2' },
        { command: 'archive', id: f.goal.id, explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  expect((await run(f.input, f.headers, '3')).status).toBe('forbidden');
  expect(
    (await readGoals(f.headers, f.workspaceId)).goals[0]?.progress.actual,
  ).toBe('220000.00');
});
test('second-leg failure rolls back funding views, balance/version, ledger/audit and receipt; retry succeeds', async () => {
  const f = await fixture();
  const before = await readAccounts(f.headers, f.workspaceId),
    trigger = `funding_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${f.destination.id}' AND NEW.role='transfer_in' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON ledger_leg FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  const e = { ...f.envelope(), expectedVersion: '1' };
  try {
    expect((await fundGoal(f.headers, e, f.input)).status).toBe('unavailable');
    expect(await readAccounts(f.headers, f.workspaceId)).toEqual(before);
    expect(
      (await readGoalFunding(f.headers, f.workspaceId, { goalId: f.goal.id }))
        .goal.progress.actual,
    ).toBe('220000.00');
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, e.operationKey)),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON ledger_leg; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await fundGoal(f.headers, e, f.input)).status).toBe('success');
});
test('negative source warning has no effect; stale account version demands fresh confirmation; replay changes goal once', async () => {
  const f = await fixture('1000');
  const e = { ...f.envelope(), expectedVersion: '1' };
  const warning = await fundGoal(f.headers, e, f.input);
  if (warning.status !== 'confirmation_required') throw Error(warning.status);
  expect(
    (await readGoalFunding(f.headers, f.workspaceId, { goalId: f.goal.id }))
      .account.balance,
  ).toBe('220000.00');
  const { createIncome } = await import('@/modules/ledger/application/income');
  expect(
    (
      await createIncome(f.headers, f.envelope(), {
        accountId: f.source.id,
        category: { name: 'Доход' },
        amount: '1',
        financialDate: '2026-10-17',
      })
    ).status,
  ).toBe('success');
  const fresh = await fundGoal(
    f.headers,
    { ...e, confirmationToken: warning.confirmationToken },
    f.input,
  );
  if (fresh.status !== 'confirmation_required') throw Error(fresh.status);
  const confirmed = { ...e, confirmationToken: fresh.confirmationToken },
    r = await fundGoal(f.headers, confirmed, f.input);
  expect(r.status).toBe('success');
  expect(await fundGoal(f.headers, confirmed, f.input)).toEqual(r);
  expect(
    (await readGoalFunding(f.headers, f.workspaceId, { goalId: f.goal.id }))
      .account.balance,
  ).toBe('240000.00');
});

test('family goal funding from own personal account returns only family projection; revoked membership denies replay/read', async () => {
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
    openingBalance: '220000',
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
      goalId: g.data.id,
      sourceWorkspaceId: guest.workspaceId,
      destinationWorkspaceId: family.data.id,
      sourceAccountId: guest.source.id,
      destinationAccountId: a.data.id,
      sourceDescription: 'Личное описание отправителя',
      destinationDescription: 'Общее пополнение',
    };
  const r = await fundGoal(guest.headers, envelope, input);
  expect(r.status).toBe('success');
  if (r.status !== 'success') throw Error(r.status);
  expect(r.data.goal.progress.actual).toBe('240000.00');
  expect(r.data.transfer.legs).toHaveLength(1);
  expect(r.data.account.history[0]?.description).toBe('Общее пополнение');
  expect(JSON.stringify(r.data)).not.toContain(guest.source.id);
  expect(JSON.stringify(r.data)).not.toContain('Личное описание отправителя');
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
  expect((await fundGoal(guest.headers, envelope, input)).status).toBe(
    'forbidden',
  );
  await expect(
    readGoalFunding(guest.headers, family.data.id, { goalId: g.data.id }),
  ).rejects.toThrow('FORBIDDEN');
});
