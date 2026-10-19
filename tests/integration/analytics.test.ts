import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { accountCommand } from '@/modules/ledger/application/accounts';
import { createExpense } from '@/modules/ledger/application/expenses';
import { createIncome } from '@/modules/ledger/application/income';
import { createTransfer } from '@/modules/ledger/application/transfers';
import { historyCommand } from '@/modules/ledger/application/history-corrections';
import { readAnalytics } from '@/modules/reporting/application/analytics';
const range = { period: 'custom', from: '2026-10-01', until: '2026-10-31' };
test('актуальные ревизии, включительные границы, переводы, исправления и удаление', async () => {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const workspaceId = scope!.id;
  const env = () => ({ workspaceId, operationKey: randomUUID() });
  const a = await accountCommand(actor.headers, env(), {
    command: 'create',
    name: 'Банк',
    type: 'cash',
    currency: 'RUB',
    openingBalance: '100000',
  });
  const b = await accountCommand(actor.headers, env(), {
    command: 'create',
    name: 'Кошелёк',
    type: 'cash',
    currency: 'RUB',
    openingBalance: '0',
  });
  if (a.status !== 'success' || b.status !== 'success') throw Error('FIXTURE');
  expect(
    (await readAnalytics(actor.headers, workspaceId, range)).totals,
  ).toEqual([]);
  const entries = [];
  for (const [amount, financialDate] of [
    ['10000', '2026-10-01'],
    ['15000', '2026-10-31'],
  ]) {
    const r = await createExpense(actor.headers, env(), {
      accountId: a.data.id,
      category: entries.length
        ? { id: entries[0]!.categoryId }
        : { name: 'Питание' },
      amount,
      financialDate,
    });
    if (r.status !== 'success') throw Error('FIXTURE');
    entries.push(r.data);
  }
  await createIncome(actor.headers, env(), {
    accountId: a.data.id,
    category: { name: 'Зарплата' },
    amount: '30000',
    financialDate: '2026-10-10',
  });
  const transfer = await createTransfer(actor.headers, env(), {
    sourceAccountId: a.data.id,
    destinationAccountId: b.data.id,
    destinationWorkspaceId: workspaceId,
    sourceWorkspaceId: workspaceId,
    debitAmount: '2000',
    creditAmount: '2000',
    financialDate: '2026-10-12',
  });
  expect(transfer.status).toBe('success');
  const report = await readAnalytics(actor.headers, workspaceId, range);
  expect(report.totals).toEqual([
    {
      currency: 'RUB',
      income: '30000.00',
      expense: '25000.00',
      difference: '5000.00',
    },
  ]);
  expect(report.categories.find((c) => c.role === 'expense')?.amount).toBe(
    '25000.00',
  );
  expect(report.accounts).toHaveLength(2);
  const changed = await historyCommand(
    actor.headers,
    { ...env(), expectedVersion: '1' },
    {
      command: 'updateEntry',
      actionId: entries[0]!.id,
      accountId: a.data.id,
      categoryId: entries[0]!.categoryId,
      amount: '12000',
      financialDate: '2026-09-30',
    },
  );
  expect(changed.status).toBe('success');
  expect(
    (await readAnalytics(actor.headers, workspaceId, range)).totals[0]?.expense,
  ).toBe('15000.00');
  expect(
    (
      await readAnalytics(actor.headers, workspaceId, {
        period: 'custom',
        from: '2026-09-30',
        until: '2026-09-30',
      })
    ).totals[0]?.expense,
  ).toBe('12000.00');
  const removed = await historyCommand(
    actor.headers,
    { ...env(), expectedVersion: '1' },
    { command: 'delete', actionId: entries[1]!.id, explicitConfirmation: true },
  );
  expect(removed.status).toBe('success');
  expect(
    (await readAnalytics(actor.headers, workspaceId, range)).totals[0]?.expense,
  ).toBe('0.00');
  const stranger = await registeredActor();
  await expect(
    readAnalytics(stranger.headers, workspaceId, range),
  ).rejects.toThrow('FORBIDDEN');
  await expect(
    readAnalytics(new Headers(), workspaceId, range),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(
    readAnalytics(actor.headers, workspaceId, {
      ...range,
      until: '2026-09-01',
    }),
  ).rejects.toThrow();
});

test('единый семейный календарь, отдельные валюты, бюджет, цель и отзыв членства', async () => {
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { member, userProfile } = await import('@/server/db/schema/identity');
  const { saveMonthlyBudget } =
    await import('@/modules/budgeting/application/monthly-budget');
  const { goalCommand } = await import('@/modules/goals/application/reserve');
  const owner = await registeredActor(),
    guest = await registeredActor();
  const family = await createFamily(owner.headers, {
    name: 'Аналитика семьи',
    timezone: 'Europe/Moscow',
    operationKey: randomUUID(),
  });
  expect(family.status).toBe('success');
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.familyOwnerId, owner.actorId));
  const workspaceId = scope!.id,
    env = () => ({ workspaceId, operationKey: randomUUID() });
  const memberId = randomUUID();
  await db.insert(member).values({
    id: memberId,
    organizationId: scope!.organizationId!,
    userId: guest.actorId,
    role: 'member',
    createdAt: new Date(),
  });
  await db
    .update(userProfile)
    .set({ timezone: 'America/Los_Angeles' })
    .where(eq(userProfile.userId, guest.actorId));
  const a = await accountCommand(owner.headers, env(), {
    command: 'create',
    name: 'Накопления',
    type: 'accumulation',
    currency: 'RUB',
    openingBalance: '50000',
  });
  const usd = await accountCommand(owner.headers, env(), {
    command: 'create',
    name: 'USD',
    type: 'cash',
    currency: 'USD',
    openingBalance: '0',
  });
  if (a.status !== 'success' || usd.status !== 'success')
    throw Error('FIXTURE');
  const expense = await createExpense(owner.headers, env(), {
    accountId: a.data.id,
    category: { name: 'Питание' },
    amount: '10000',
    financialDate: '2026-11-01',
  });
  if (expense.status !== 'success') throw Error('FIXTURE');
  expect(
    (
      await createIncome(owner.headers, env(), {
        accountId: usd.data.id,
        category: { name: 'Доход USD' },
        amount: '1.01',
        financialDate: '2026-11-01',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await saveMonthlyBudget(owner.headers, env(), {
        month: '2026-11',
        currency: 'RUB',
        plannedIncome: '30000',
        categoryLimits: [
          { categoryId: expense.data.categoryId, amount: '15000' },
        ],
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await goalCommand(owner.headers, env(), {
        command: 'create',
        type: 'ordinary',
        name: 'Цель',
        accountId: a.data.id,
        currency: 'RUB',
        ordinaryTarget: '100000',
      })
    ).status,
  ).toBe('success');
  const instant = new Date('2026-10-31T22:30:00Z');
  const one = await readAnalytics(
    owner.headers,
    workspaceId,
    { period: 'current' },
    instant,
  );
  const two = await readAnalytics(
    guest.headers,
    workspaceId,
    { period: 'current' },
    instant,
  );
  expect(two).toEqual(one);
  expect(one.from).toBe('2026-11-01');
  expect(one.until).toBe('2026-11-30');
  expect(one.totals).toEqual([
    {
      currency: 'RUB',
      income: '0.00',
      expense: '10000.00',
      difference: '-10000.00',
    },
    { currency: 'USD', income: '1.01', expense: '0.00', difference: '1.01' },
  ]);
  expect(one.budgets[0]).toMatchObject({
    actual: '10000.00',
    remaining: '5000.00',
  });
  expect(one.goals[0]?.progress.actual).toBe('40000.00');
  expect(one.accounts.find((a) => a.currency === 'RUB')?.balance).toBe(
    '40000.00',
  );
  expect(
    (
      await readAnalytics(
        owner.headers,
        workspaceId,
        { period: 'previous' },
        instant,
      )
    ).totals,
  ).toEqual([]);
  expect(
    (
      await readAnalytics(
        owner.headers,
        workspaceId,
        { period: 'year' },
        instant,
      )
    ).totals,
  ).toEqual(one.totals);
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...env(), expectedVersion: '1' },
        { command: 'timezone', timezone: 'America/Los_Angeles' },
      )
    ).status,
  ).toBe('success');
  const changedZone = await readAnalytics(
    guest.headers,
    workspaceId,
    { period: 'current' },
    instant,
  );
  expect(changedZone.from).toBe('2026-10-01');
  expect(changedZone.totals).toEqual([]);
  expect(
    (
      await readAnalytics(
        guest.headers,
        workspaceId,
        { period: 'custom', from: '2026-11-01', until: '2026-11-01' },
        instant,
      )
    ).totals,
  ).toEqual(one.totals);
  await db.delete(member).where(eq(member.id, memberId));
  await expect(
    readAnalytics(guest.headers, workspaceId, { period: 'current' }, instant),
  ).rejects.toThrow('FORBIDDEN');
});

test('удалённая семья не предоставляет обычный отчёт даже владельцу', async () => {
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const owner = await registeredActor();
  expect(
    (
      await createFamily(owner.headers, {
        name: 'Удаляемая семья',
        timezone: 'Europe/Moscow',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('success');
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.familyOwnerId, owner.actorId));
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          workspaceId: scope!.id,
          operationKey: randomUUID(),
          expectedVersion: '1',
        },
        { command: 'delete', explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  await expect(
    readAnalytics(owner.headers, scope!.id, { period: 'year' }),
  ).rejects.toThrow('FORBIDDEN');
});
