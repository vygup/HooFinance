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
import { member, userProfile } from '@/server/db/schema/identity';
import { obligationOccurrence } from '@/server/db/schema/recurring-payments';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { createIncome } from '@/modules/ledger/application/income';
import { createExpense } from '@/modules/ledger/application/expenses';
import { createTransfer } from '@/modules/ledger/application/transfers';
import { historyCommand } from '@/modules/ledger/application/history-corrections';
import { goalCommand } from '@/modules/goals/application/reserve';
import { saveMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import {
  createFamily,
  familyCommand,
} from '@/modules/workspaces/application/family';
import { readWorkspaceDashboard } from '@/modules/reporting/application/dashboard';
const instant = new Date('2026-10-15T12:00:00Z');
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const workspaceId = scope!.id;
  return {
    ...actor,
    workspaceId,
    env: () => ({ workspaceId, operationKey: randomUUID() }),
  };
}
async function account(
  f: Awaited<ReturnType<typeof fixture>>,
  name: string,
  openingBalance: string,
  currency = 'RUB',
) {
  const r = await accountCommand(f.headers, f.env(), {
    command: 'create',
    name,
    type: 'accumulation',
    currency,
    openingBalance,
  });
  if (r.status !== 'success') throw Error('FIXTURE_ACCOUNT');
  return r.data;
}
test('снимок совпадает с историей и планами, цели и резервы не удваивают деньги, исправления пересчитываются', async () => {
  const f = await fixture();
  const empty = await readWorkspaceDashboard(
    f.headers,
    { workspaceId: f.workspaceId },
    instant,
  );
  expect(empty).toMatchObject({
    accounts: [],
    balances: [],
    monthly: [],
    budgets: [],
    goals: [],
    reserves: [],
    latestActions: [],
  });
  const bank = await account(f, 'Банк', '100000');
  const target = await account(f, 'Цель', '200000');
  const reserve = await account(f, 'Резерв', '220000');
  await account(f, 'USD', '1.01', 'USD');
  for (const input of [
    {
      type: 'ordinary',
      name: 'Покупка',
      accountId: target.id,
      ordinaryTarget: '300000',
    },
    {
      type: 'reserve',
      name: 'Подушка',
      accountId: reserve.id,
      monthlyAmount: '50000',
      coverageMonths: '12',
    },
  ])
    expect(
      (
        await goalCommand(f.headers, f.env(), {
          ...input,
          command: 'create',
          currency: 'RUB',
        })
      ).status,
    ).toBe('success');
  const expense = await createExpense(f.headers, f.env(), {
    accountId: bank.id,
    amount: '10000',
    category: { name: 'Питание' },
    financialDate: '2026-10-01',
  });
  if (expense.status !== 'success') throw Error('FIXTURE_EXPENSE');
  expect(
    (
      await createIncome(f.headers, f.env(), {
        accountId: bank.id,
        amount: '25000.01',
        category: { name: 'Доход' },
        financialDate: '2026-10-31',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await createIncome(f.headers, f.env(), {
        accountId: bank.id,
        amount: '0.01',
        category: { name: 'Прошлый месяц' },
        financialDate: '2026-09-30',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await createTransfer(f.headers, f.env(), {
        sourceAccountId: bank.id,
        destinationAccountId: target.id,
        sourceWorkspaceId: f.workspaceId,
        destinationWorkspaceId: f.workspaceId,
        debitAmount: '2000',
        creditAmount: '2000',
        financialDate: '2026-10-12',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await saveMonthlyBudget(f.headers, f.env(), {
        month: '2026-10',
        currency: 'RUB',
        plannedIncome: '30000',
        categoryLimits: [
          { categoryId: expense.data.categoryId, amount: '15000' },
        ],
      })
    ).status,
  ).toBe('success');
  const report = await readWorkspaceDashboard(
    f.headers,
    { workspaceId: f.workspaceId },
    instant,
  );
  expect(report.balances).toEqual(
    (await readAccounts(f.headers, f.workspaceId)).totals,
  );
  expect(report.balances).toEqual([
    { currency: 'RUB', amount: '535000.02' },
    { currency: 'USD', amount: '1.01' },
  ]);
  expect(report.monthly).toEqual([
    {
      currency: 'RUB',
      income: '25000.01',
      expense: '10000.00',
      difference: '15000.01',
    },
    { currency: 'USD', income: '0.00', expense: '0.00', difference: '0.00' },
  ]);
  expect(report.budgets[0]).toMatchObject({
    actual: '10000.00',
    remaining: '5000.00',
  });
  expect(report.goals[0]?.progress).toMatchObject({
    actual: '202000.00',
    target: '300000.00',
    remaining: '98000.00',
  });
  expect(report.reserves[0]?.progress).toMatchObject({
    actual: '220000.00',
    target: '600000.00',
    remaining: '380000.00',
    coverage: '4.4',
  });
  expect(report.latestActions).toHaveLength(4);
  expect(new Set(report.latestActions.map((a) => a.id)).size).toBe(4);
  const changed = await historyCommand(
    f.headers,
    { ...f.env(), expectedVersion: '1' },
    {
      command: 'updateEntry',
      actionId: expense.data.id,
      accountId: bank.id,
      categoryId: expense.data.categoryId,
      amount: '12000',
      financialDate: '2026-09-30',
    },
  );
  expect(changed.status).toBe('success');
  const after = await readWorkspaceDashboard(
    f.headers,
    { workspaceId: f.workspaceId },
    instant,
  );
  expect(after.monthly[0]?.expense).toBe('0.00');
  expect(after.budgets[0]?.actual).toBe('0.00');
  expect(
    (
      await historyCommand(
        f.headers,
        { ...f.env(), expectedVersion: '2' },
        {
          command: 'delete',
          actionId: expense.data.id,
          explicitConfirmation: true,
        },
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await readWorkspaceDashboard(
        f.headers,
        { workspaceId: f.workspaceId },
        instant,
      )
    ).latestActions.some((a) => a.id === expense.data.id),
  ).toBe(false);
});
test('личное и две семьи изолированы, семейный месяц един для участников, отзыв доступа и удалённая семья запрещены', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const personal = await account(owner, 'Личный секрет', '123.45');
  const familyIds: string[] = [];
  for (const name of ['Первая семья', 'Вторая семья']) {
    const result = await createFamily(owner.headers, {
      name,
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    });
    if (result.status !== 'success') throw Error('FIXTURE_FAMILY');
    familyIds.push(result.data.id);
  }
  const familyId = familyIds[0]!;
  const [family] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, familyId));
  const memberId = randomUUID();
  await db
    .insert(member)
    .values({
      id: memberId,
      organizationId: family!.organizationId!,
      userId: guest.actorId,
      role: 'member',
      createdAt: new Date(),
    });
  await db
    .update(userProfile)
    .set({ timezone: 'America/Los_Angeles' })
    .where(eq(userProfile.userId, guest.actorId));
  const env = () => ({ workspaceId: familyId, operationKey: randomUUID() });
  const familyAccount = await account(
    { ...owner, workspaceId: familyId, env },
    'Семейный',
    '0',
  );
  expect(
    (
      await createTransfer(owner.headers, env(), {
        sourceAccountId: personal.id,
        destinationAccountId: familyAccount.id,
        sourceWorkspaceId: owner.workspaceId,
        destinationWorkspaceId: familyId,
        debitAmount: '1',
        creditAmount: '1',
        financialDate: '2026-11-01',
        sourceDescription: 'Секрет личной стороны',
        destinationDescription: 'Общий взнос',
      })
    ).status,
  ).toBe('success');
  const boundary = new Date('2026-10-31T22:30:00Z');
  const one = await readWorkspaceDashboard(
    owner.headers,
    { workspaceId: familyId },
    boundary,
  );
  const two = await readWorkspaceDashboard(
    guest.headers,
    { workspaceId: familyId },
    boundary,
  );
  expect(two).toEqual(one);
  expect(one.month).toBe('2026-11');
  expect(one.monthly[0]).toMatchObject({ income: '0.00', expense: '0.00' });
  expect(JSON.stringify(two)).not.toContain('Личный секрет');
  expect(JSON.stringify(two)).not.toContain('Секрет личной стороны');
  expect(JSON.stringify(two)).not.toContain(personal.id);
  expect(
    (
      await readWorkspaceDashboard(
        owner.headers,
        { workspaceId: familyIds[1]! },
        boundary,
      )
    ).accounts,
  ).toEqual([]);
  await expect(
    readWorkspaceDashboard(
      guest.headers,
      { workspaceId: owner.workspaceId },
      boundary,
    ),
  ).rejects.toThrow('FORBIDDEN');
  await expect(
    readWorkspaceDashboard(new Headers(), { workspaceId: familyId }, boundary),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(
    readWorkspaceDashboard(
      owner.headers,
      { workspaceId: familyId, actorId: guest.actorId },
      boundary,
    ),
  ).rejects.toThrow();
  await db.delete(member).where(eq(member.id, memberId));
  await expect(
    readWorkspaceDashboard(guest.headers, { workspaceId: familyId }, boundary),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await familyCommand(
        owner.headers,
        { ...env(), expectedVersion: '1' },
        { command: 'delete', explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  await expect(
    readWorkspaceDashboard(owner.headers, { workspaceId: familyId }, boundary),
  ).rejects.toThrow('FORBIDDEN');
});
test('платежи включают непросмотренную просрочку и будущий интервал; чтение не материализует экземпляры и не создаёт денег', async () => {
  const { obligationCommand } =
    await import('@/modules/obligations/application/recurring-payments');
  const { categoryCommand } =
    await import('@/modules/categories/application/expenses');
  const f = await fixture();
  const a = await account(f, 'Банк', '100000');
  const category = await categoryCommand(f.headers, f.env(), {
    command: 'create',
    name: 'Кредит',
    kind: 'expense',
  });
  if (category.status !== 'success') throw Error('FIXTURE_CATEGORY');
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    expect(
      (
        await obligationCommand(f.headers, f.env(), {
          command: 'create',
          name: 'Платёж',
          amount: '1000',
          currency: 'RUB',
          anchorDate: '2026-01-31',
          repeatEvery: 1,
          repeatUnit: 'month',
          accountId: a.id,
          categoryId: category.data.id,
        })
      ).status,
    ).toBe('success');
  } finally {
    vi.useRealTimers();
  }
  const before = await readAccounts(f.headers, f.workspaceId);
  const occurrences = await db
    .select()
    .from(obligationOccurrence)
    .where(eq(obligationOccurrence.workspaceId, f.workspaceId));
  const first = await readWorkspaceDashboard(
    f.headers,
    { workspaceId: f.workspaceId },
    new Date('2026-04-15T12:00:00Z'),
  );
  expect(first.upcoming.from).toBe('2026-04-15');
  expect(first.upcoming.until).toBe('2026-05-15');
  expect(first.upcoming.payments.map((p) => p.scheduledDate)).toEqual([
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
  expect(first.upcoming.overdue).toEqual([
    { currency: 'RUB', amount: '3000.00' },
  ]);
  expect(
    await readWorkspaceDashboard(
      f.headers,
      { workspaceId: f.workspaceId },
      new Date('2026-04-15T12:00:00Z'),
    ),
  ).toEqual(first);
  expect(await readAccounts(f.headers, f.workspaceId)).toEqual(before);
  expect(
    await db
      .select()
      .from(obligationOccurrence)
      .where(eq(obligationOccurrence.workspaceId, f.workspaceId)),
  ).toEqual(occurrences);
});
