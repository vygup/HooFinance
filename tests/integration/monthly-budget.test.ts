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
import { category } from '@/server/db/schema/categories';
import { monthlyBudget, budgetLimit } from '@/server/db/schema/monthly-budget';
import { scopedAuditEvent, commandReceipt } from '@/server/db/schema/ledger';
import {
  saveMonthlyBudget,
  readMonthlyBudget,
} from '@/modules/budgeting/application/monthly-budget';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { createExpense } from '@/modules/ledger/application/expenses';
import { createTransfer } from '@/modules/ledger/application/transfers';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const [cat] = await db
    .insert(category)
    .values({ workspaceId: scope!.id, name: 'Продукты', kind: 'expense' })
    .returning();
  return {
    ...actor,
    workspaceId: scope!.id,
    cat: cat!,
    envelope: { workspaceId: scope!.id, operationKey: randomUUID() },
    input: {
      month: '2026-10',
      currency: 'RUB',
      plannedIncome: '200000',
      categoryLimits: [{ categoryId: cat!.id, amount: '30000' }],
    },
  };
}
test('save/replay/concurrent create, version conflict, audit, monthly isolation and exact fact excluding opening/transfers', async () => {
  const f = await fixture();
  expect(
    (await readMonthlyBudget(f.headers, f.workspaceId, '2026-10', 'RUB'))
      .budget,
  ).toBeNull();
  const [a, b] = await Promise.all([
    saveMonthlyBudget(f.headers, f.envelope, f.input),
    saveMonthlyBudget(f.headers, f.envelope, f.input),
  ]);
  expect(a).toEqual(b);
  if (a.status !== 'success') throw Error(a.status);
  expect(
    (
      await saveMonthlyBudget(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        f.input,
      )
    ).status,
  ).toBe('conflict');
  const make = async (name: string) => {
    const r = await accountCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID() },
      {
        command: 'create',
        name,
        type: 'cash',
        currency: 'RUB',
        openingBalance: '100000',
      },
    );
    if (r.status !== 'success') throw Error(r.status);
    return r.data;
  };
  const from = await make('Банк'),
    to = await make('Накопления');
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        {
          accountId: from.id,
          category: { id: f.cat.id },
          amount: '33000',
          financialDate: '2026-10-31',
        },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        {
          accountId: from.id,
          category: { name: 'Без лимита' },
          amount: '2000',
          financialDate: '2026-10-01',
        },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        {
          accountId: from.id,
          category: { id: f.cat.id },
          amount: '100',
          financialDate: '2026-11-01',
        },
      )
    ).status,
  ).toBe('success');
  const transfer = await createTransfer(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    {
      sourceWorkspaceId: f.workspaceId,
      destinationWorkspaceId: f.workspaceId,
      sourceAccountId: from.id,
      destinationAccountId: to.id,
      debitAmount: '500',
      creditAmount: '500',
      financialDate: '2026-10-17',
    },
  );
  expect(transfer.status).toBe('success');
  const view = await readMonthlyBudget(
    f.headers,
    f.workspaceId,
    '2026-10',
    'RUB',
  );
  expect(view.summary).toMatchObject({
    actual: '35000.00',
    remaining: '-5000.00',
  });
  expect(
    view.summary.categories.find((c) => c.categoryId === f.cat.id),
  ).toMatchObject({ percent: '110.00', remaining: '-3000.00' });
  expect(
    (await readMonthlyBudget(f.headers, f.workspaceId, '2026-11', 'RUB'))
      .summary.actual,
  ).toBe('100.00');
  expect(
    (await readMonthlyBudget(f.headers, f.workspaceId, '2026-10', 'USD'))
      .summary.actual,
  ).toBe('0.00');
  const balances = await readAccounts(f.headers, f.workspaceId);
  const edit = {
    ...f.envelope,
    operationKey: randomUUID(),
    expectedVersion: '1',
  };
  expect(
    (
      await saveMonthlyBudget(f.headers, edit, {
        ...f.input,
        plannedIncome: '210000',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await saveMonthlyBudget(
        f.headers,
        { ...edit, operationKey: randomUUID() },
        f.input,
      )
    ).status,
  ).toBe('conflict');
  expect(await readAccounts(f.headers, f.workspaceId)).toEqual(balances);
  expect(
    await db
      .select()
      .from(scopedAuditEvent)
      .where(eq(scopedAuditEvent.objectId, a.data.id)),
  ).toHaveLength(2);
});
test('authorization, input validation, foreign/income category; rollback and direct DB invariants', async () => {
  const f = await fixture(),
    other = await fixture();
  expect(
    (await saveMonthlyBudget(new Headers(), f.envelope, f.input)).status,
  ).toBe('unauthorized');
  expect(
    (await saveMonthlyBudget(other.headers, f.envelope, f.input)).status,
  ).toBe('forbidden');
  await expect(
    readMonthlyBudget(other.headers, f.workspaceId, '2026-10', 'RUB'),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await saveMonthlyBudget(f.headers, f.envelope, {
        ...f.input,
        plannedIncome: '1.001',
      })
    ).status,
  ).toBe('validation');
  for (const categoryId of [
    other.cat.id,
    (
      await db
        .insert(category)
        .values({ workspaceId: f.workspaceId, name: 'Доход', kind: 'income' })
        .returning()
    )[0]!.id,
  ])
    expect(
      (
        await saveMonthlyBudget(f.headers, f.envelope, {
          ...f.input,
          categoryLimits: [{ categoryId, amount: '1' }],
        })
      ).status,
    ).toBe('forbidden');
  const trigger = `budget_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id='${f.workspaceId}' AND NEW.object_type='monthly_budget' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect(
      (await saveMonthlyBudget(f.headers, f.envelope, f.input)).status,
    ).toBe('unavailable');
    expect(
      await db
        .select()
        .from(monthlyBudget)
        .where(eq(monthlyBudget.workspaceId, f.workspaceId)),
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
  const r = await saveMonthlyBudget(f.headers, f.envelope, f.input);
  if (r.status !== 'success') throw Error(r.status);
  await expect(
    db.insert(budgetLimit).values({
      workspaceId: f.workspaceId,
      budgetId: r.data.id,
      categoryId: other.cat.id,
      amount: '1',
    }),
  ).rejects.toThrow();
  await expect(
    db.insert(monthlyBudget).values({
      workspaceId: f.workspaceId,
      month: '2026-11-02',
      currency: 'RUB',
      plannedIncome: '1',
    }),
  ).rejects.toThrow();
  for (const plannedIncome of ['-1', 'NaN', 'Infinity', '1.001'])
    await expect(
      db.insert(monthlyBudget).values({
        workspaceId: f.workspaceId,
        month: '2026-11-01',
        currency: 'RUB',
        plannedIncome,
      }),
    ).rejects.toThrow();
});

test('family member can save; concurrent edits serialize; revoked access denies replay/read and deleted family denies writes', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { member } = await import('@/server/db/schema/identity');
  const family = await createFamily(
    owner.headers,
    {
      name: 'Бюджет семьи',
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
  const input = { ...owner.input, categoryLimits: [] };
  const envelope = { workspaceId: family.data.id, operationKey: randomUUID() };
  const saved = await saveMonthlyBudget(guest.headers, envelope, input);
  expect(saved.status).toBe('success');
  const edits = await Promise.all(
    ['210000', '220000'].map((plannedIncome) =>
      saveMonthlyBudget(
        guest.headers,
        { ...envelope, operationKey: randomUUID(), expectedVersion: '1' },
        { ...input, plannedIncome },
      ),
    ),
  );
  expect(edits.map((e) => e.status).sort()).toEqual(['conflict', 'success']);
  expect(
    (
      await readMonthlyBudget(
        owner.headers,
        family.data.id,
        input.month,
        input.currency,
      )
    ).budget?.version,
  ).toBe('2');
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...envelope,
          operationKey: randomUUID(),
          expectedVersion: family.data.version,
        },
        { command: 'remove', memberId: membership!.id },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect((await saveMonthlyBudget(guest.headers, envelope, input)).status).toBe(
    'forbidden',
  );
  await expect(
    readMonthlyBudget(
      guest.headers,
      family.data.id,
      input.month,
      input.currency,
    ),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...envelope,
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
      await saveMonthlyBudget(
        owner.headers,
        { ...envelope, operationKey: randomUUID(), expectedVersion: '2' },
        input,
      )
    ).status,
  ).toBe('forbidden');
});
