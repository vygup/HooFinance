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
import { category } from '@/server/db/schema/categories';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  actionRevision,
  ledgerLeg,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import {
  createExpense,
  readExpenses,
} from '@/modules/ledger/application/expenses';
import { createIncome } from '@/modules/ledger/application/income';
import {
  createTransfer,
  readTransferOptions,
} from '@/modules/ledger/application/transfers';
import {
  historyCommand,
  readHistory,
} from '@/modules/ledger/application/history-corrections';
import { readMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import {
  createFamily,
  familyCommand,
  respondFamilyInvitation,
} from '@/modules/workspaces/application/family';
import { invitation, member } from '@/server/db/schema/identity';
import { encryptToken } from '@/server/security/encryption';

async function account(
  headers: Headers,
  workspaceId: string,
  name = 'Счёт',
  type = 'cash',
) {
  const r = await accountCommand(
    headers,
    { workspaceId, operationKey: randomUUID() },
    { command: 'create', name, type, currency: 'RUB', openingBalance: '10000' },
  );
  if (r.status !== 'success') throw Error('FIXTURE_ACCOUNT');
  return r.data;
}
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const workspaceId = scope!.id;
  const a = await account(actor.headers, workspaceId);
  const r = await createExpense(
    actor.headers,
    { workspaceId, operationKey: randomUUID() },
    {
      accountId: a.id,
      category: { name: 'Еда' },
      amount: '1000',
      financialDate: '2026-09-15',
      description: 'Покупка 100%',
    },
  );
  if (r.status !== 'success') throw Error('FIXTURE_EXPENSE');
  return { ...actor, workspaceId, account: a, entry: r.data };
}
const env = (workspaceId: string, expectedVersion = '1') => ({
  workspaceId,
  operationKey: randomUUID(),
  expectedVersion,
});
function update(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    command: 'updateEntry',
    actionId: f.entry.id,
    accountId: f.account.id,
    categoryId: f.entry.categoryId,
    amount: '1500',
    financialDate: '2026-10-15',
    description: 'Исправлено',
  };
}
test('US21: 1000→1500, both months/budget/current history, audit revisions, delete and replay', async () => {
  const f = await fixture();
  const e = env(f.workspaceId);
  const result = await historyCommand(f.headers, e, update(f));
  expect(result.status).toBe('success');
  expect(await historyCommand(f.headers, e, update(f))).toEqual(result);
  expect(
    (await readAccounts(f.headers, f.workspaceId)).accounts[0],
  ).toMatchObject({ balance: '8500.00' });
  expect(
    (await readExpenses(f.headers, f.workspaceId, '2026-09')).totals,
  ).toEqual([]);
  expect(
    (await readExpenses(f.headers, f.workspaceId, '2026-10')).totals,
  ).toEqual([{ currency: 'RUB', amount: '1500.00' }]);
  expect(
    JSON.stringify(
      (await readMonthlyBudget(f.headers, f.workspaceId, '2026-10', 'RUB'))
        .summary,
    ),
  ).toContain('1500.00');
  const h = await readHistory(f.headers, f.workspaceId, {});
  expect(h.actions[0]).toMatchObject({
    version: '2',
    status: 'active',
    creatorId: f.actorId,
  });
  expect(h.actions[0]!.revisions).toHaveLength(2);
  expect(h.actions[0]!.revisions[0]).toMatchObject({
    actorId: f.actorId,
    legs: [expect.objectContaining({ amount: '1000.00' })],
  });
  const d = {
    command: 'delete',
    actionId: f.entry.id,
    explicitConfirmation: true,
  };
  const de = env(f.workspaceId, '2');
  const deleted = await historyCommand(f.headers, de, d);
  expect(deleted.status).toBe('success');
  expect(await historyCommand(f.headers, de, d)).toEqual(deleted);
  expect(
    (await readAccounts(f.headers, f.workspaceId)).accounts[0]!.balance,
  ).toBe('10000.00');
  expect(
    (await readExpenses(f.headers, f.workspaceId, '2026-10')).totals,
  ).toEqual([]);
  expect(
    (await readHistory(f.headers, f.workspaceId, {})).actions[0],
  ).toMatchObject({
    status: 'deleted',
    revisions: expect.arrayContaining([
      expect.objectContaining({ status: 'deleted' }),
    ]),
  });
  expect(
    (await historyCommand(f.headers, env(f.workspaceId, '3'), update(f)))
      .status,
  ).toBe('conflict');
});
test('conjoined filters, literal substring search, archive preservation, account/category move, isolation', async () => {
  const f = await fixture(),
    other = await fixture();
  const filters = {
    from: '2026-09-01',
    to: '2026-09-30',
    accountId: f.account.id,
    categoryId: f.entry.categoryId,
    text: '100%',
  };
  expect(
    (await readHistory(f.headers, f.workspaceId, filters)).actions,
  ).toHaveLength(1);
  for (const change of [
    { text: '100_' },
    { from: '2026-09-16' },
    { accountId: other.account.id },
    { categoryId: other.entry.categoryId },
  ])
    expect(
      (await readHistory(f.headers, f.workspaceId, { ...filters, ...change }))
        .actions,
    ).toHaveLength(0);
  await expect(readHistory(other.headers, f.workspaceId, {})).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (await historyCommand(other.headers, env(f.workspaceId), update(f))).status,
  ).toBe('forbidden');
  expect(
    (await historyCommand(f.headers, env(other.workspaceId), update(f))).status,
  ).toBe('forbidden');
  expect(
    (await historyCommand(new Headers(), env(f.workspaceId), update(f))).status,
  ).toBe('unauthorized');
  await db
    .update(category)
    .set({ archivedAt: new Date() })
    .where(eq(category.id, f.entry.categoryId));
  await db
    .update(financialAccount)
    .set({ archivedAt: new Date() })
    .where(eq(financialAccount.id, f.account.id));
  expect(
    (await historyCommand(f.headers, env(f.workspaceId), update(f))).status,
  ).toBe('success');
  const dest = await account(f.headers, f.workspaceId, 'Другой');
  const [cat] = await db
    .insert(category)
    .values({ workspaceId: f.workspaceId, name: 'Другая', kind: 'expense' })
    .returning();
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId, '2'), {
        ...update(f),
        accountId: dest.id,
        categoryId: cat!.id,
      })
    ).status,
  ).toBe('success');
  const balances = (await readAccounts(f.headers, f.workspaceId)).accounts;
  expect(balances.find((a) => a.id === f.account.id)!.balance).toBe('10000.00');
  expect(balances.find((a) => a.id === dest.id)!.balance).toBe('8500.00');
});
test('stale version race, precision/category errors, warning decline/stale/confirm, rollback at audit', async () => {
  const f = await fixture();
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId), {
        ...update(f),
        amount: '1.005',
      })
    ).status,
  ).toBe('validation');
  const [wrong] = await db
    .insert(category)
    .values({ workspaceId: f.workspaceId, name: 'Доход', kind: 'income' })
    .returning();
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId), {
        ...update(f),
        categoryId: wrong!.id,
      })
    ).status,
  ).toBe('forbidden');
  const races = await Promise.all([
    historyCommand(f.headers, env(f.workspaceId), update(f)),
    historyCommand(f.headers, env(f.workspaceId), update(f)),
  ]);
  expect(races.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  const e = env(f.workspaceId, '2'),
    input = { ...update(f), amount: '11000' };
  const warning = await historyCommand(f.headers, e, input);
  if (warning.status !== 'confirmation_required') throw Error('WARNING');
  expect(warning.balances[0]!.amount).toBe('-1000.00');
  expect(
    (await readAccounts(f.headers, f.workspaceId)).accounts[0]!.balance,
  ).toBe('8500.00');
  await createIncome(
    f.headers,
    { workspaceId: f.workspaceId, operationKey: randomUUID() },
    {
      accountId: f.account.id,
      category: { name: 'Доход' },
      amount: '1',
      financialDate: '2026-10-15',
    },
  );
  const stale = await historyCommand(
    f.headers,
    { ...e, confirmationToken: warning.confirmationToken },
    input,
  );
  if (stale.status !== 'confirmation_required') throw Error('STALE_WARNING');
  expect(stale.balances[0]!.amount).toBe('-999.00');
  const trigger = `history_failure_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${f.entry.id}' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  const confirmed = { ...e, confirmationToken: stale.confirmationToken };
  try {
    expect((await historyCommand(f.headers, confirmed, input)).status).toBe(
      'unavailable',
    );
    expect(
      await db
        .select()
        .from(actionRevision)
        .where(eq(actionRevision.actionId, f.entry.id)),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, e.operationKey)),
    ).toHaveLength(0);
    expect(
      (await readAccounts(f.headers, f.workspaceId)).accounts[0]!.balance,
    ).toBe('8501.00');
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await historyCommand(f.headers, confirmed, input)).status).toBe(
    'success',
  );
});

test('moving an entry keeps request identity stable on replay and rejects competing stale moves', async () => {
  const f = await fixture();
  const dest = await account(f.headers, f.workspaceId, 'Новый счёт');
  const e = env(f.workspaceId),
    input = { ...update(f), accountId: dest.id };
  const result = await historyCommand(f.headers, e, input);
  expect(result.status).toBe('success');
  expect(await historyCommand(f.headers, e, input)).toEqual(result);
  expect(
    (await historyCommand(f.headers, env(f.workspaceId), update(f))).status,
  ).toBe('conflict');
  expect(
    (await readAccounts(f.headers, f.workspaceId)).accounts.find(
      (a) => a.id === dest.id,
    )!.balance,
  ).toBe('8500.00');
});
test('transfer edits/deletes are one revision, goal follows balance, no expense fact; delete income warns', async () => {
  const f = await fixture();
  const dest = await account(f.headers, f.workspaceId, 'Накопления', 'savings');
  expect(
    (
      await goalCommand(
        f.headers,
        { workspaceId: f.workspaceId, operationKey: randomUUID() },
        {
          command: 'create',
          type: 'ordinary',
          name: 'Цель',
          accountId: dest.id,
          currency: 'RUB',
          ordinaryTarget: '20000',
        },
      )
    ).status,
  ).toBe('success');
  const t = {
    sourceWorkspaceId: f.workspaceId,
    destinationWorkspaceId: f.workspaceId,
    sourceAccountId: f.account.id,
    destinationAccountId: dest.id,
    debitAmount: '1000',
    creditAmount: '1000',
    financialDate: '2026-09-15',
    sourceDescription: 'Со счёта',
    destinationDescription: 'В цель',
  };
  const created = await createTransfer(
    f.headers,
    { workspaceId: f.workspaceId, operationKey: randomUUID() },
    t,
  );
  if (created.status !== 'success') throw Error('TRANSFER');
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId), {
        command: 'updateTransfer',
        actionId: created.data.id,
        ...t,
        debitAmount: '1500',
        creditAmount: '1500',
      })
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.workspaceId)).goals[0]!.progress.actual,
  ).toBe('11500.00');
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.actionId, created.data.id)),
  ).toHaveLength(4);
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId, '2'), {
        command: 'delete',
        actionId: created.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('success');
  expect(
    (await readGoals(f.headers, f.workspaceId)).goals[0]!.progress.actual,
  ).toBe('10000.00');
  expect(
    (await readExpenses(f.headers, f.workspaceId, '2026-09')).totals,
  ).toEqual([{ currency: 'RUB', amount: '1000.00' }]);
  const income = await createIncome(
    f.headers,
    { workspaceId: f.workspaceId, operationKey: randomUUID() },
    {
      accountId: f.account.id,
      category: { name: 'Доход' },
      amount: '2000',
      financialDate: '2026-10-15',
    },
  );
  if (income.status !== 'success') throw Error('INCOME');
  await createExpense(
    f.headers,
    { workspaceId: f.workspaceId, operationKey: randomUUID() },
    {
      accountId: f.account.id,
      category: { id: f.entry.categoryId },
      amount: '10000',
      financialDate: '2026-10-15',
    },
  );
  expect(
    (
      await historyCommand(f.headers, env(f.workspaceId), {
        command: 'delete',
        actionId: income.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('confirmation_required');
});

test('member edits another author; cross-space owner only, audit privacy, revoke prevents replay', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const family = await createFamily(
    owner.headers,
    { name: 'Семья', timezone: 'Europe/Moscow', operationKey: randomUUID() },
    mockMail,
  );
  if (family.status !== 'success') throw Error('FAMILY');
  await familyCommand(
    owner.headers,
    env(family.data.id),
    { command: 'invite', email: guest.email },
    mockMail,
  );
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, family.data.organizationId));
  await respondFamilyInvitation(guest.headers, {
    secret: encryptToken(inv!.id, 'invitation-link'),
    decision: 'accept',
    operationKey: randomUUID(),
  });
  const shared = await account(owner.headers, family.data.id);
  const secondShared = await account(
    owner.headers,
    family.data.id,
    'Второй общий',
  );
  const income = await createIncome(
    owner.headers,
    { workspaceId: family.data.id, operationKey: randomUUID() },
    {
      accountId: shared.id,
      category: { name: 'Общий доход' },
      amount: '10',
      financialDate: '2026-10-01',
    },
  );
  if (income.status !== 'success') throw Error('INCOME_FIXTURE');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id), {
        command: 'updateEntry',
        actionId: income.data.id,
        accountId: shared.id,
        categoryId: income.data.categoryId,
        amount: '20',
        financialDate: '2026-10-02',
        description: 'Исправил участник',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id, '2'), {
        command: 'delete',
        actionId: income.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('success');
  const internalInput = {
    sourceWorkspaceId: family.data.id,
    destinationWorkspaceId: family.data.id,
    sourceAccountId: shared.id,
    destinationAccountId: secondShared.id,
    debitAmount: '10',
    creditAmount: '10',
    financialDate: '2026-10-01',
    sourceDescription: 'Общее списание',
    destinationDescription: 'Общее зачисление',
  };
  const internal = await createTransfer(
    owner.headers,
    { workspaceId: family.data.id, operationKey: randomUUID() },
    internalInput,
  );
  if (internal.status !== 'success') throw Error('INTERNAL_TRANSFER');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id), {
        command: 'updateTransfer',
        actionId: internal.data.id,
        ...internalInput,
        debitAmount: '20',
        creditAmount: '20',
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id, '2'), {
        command: 'delete',
        actionId: internal.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('success');
  const expense = await createExpense(
    owner.headers,
    { workspaceId: family.data.id, operationKey: randomUUID() },
    {
      accountId: shared.id,
      category: { name: 'Общее' },
      amount: '1000',
      financialDate: '2026-09-15',
    },
  );
  if (expense.status !== 'success') throw Error('EXPENSE');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id), {
        ...update(owner),
        actionId: expense.data.id,
        accountId: shared.id,
        categoryId: expense.data.categoryId,
      })
    ).status,
  ).toBe('success');
  expect(
    (
      await historyCommand(guest.headers, env(family.data.id, '2'), {
        command: 'delete',
        actionId: expense.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('success');
  const t = {
    sourceWorkspaceId: owner.workspaceId,
    destinationWorkspaceId: family.data.id,
    sourceAccountId: owner.account.id,
    destinationAccountId: shared.id,
    debitAmount: '100',
    creditAmount: '100',
    financialDate: '2026-10-15',
    sourceDescription: 'Личный секрет',
    destinationDescription: 'Общее',
  };
  const transfer = await createTransfer(
    owner.headers,
    { workspaceId: owner.workspaceId, operationKey: randomUUID() },
    t,
  );
  if (transfer.status !== 'success') throw Error('TRANSFER');
  const input = {
    command: 'updateTransfer',
    actionId: transfer.data.id,
    ...t,
    debitAmount: '200',
    creditAmount: '200',
  };
  expect(
    (await historyCommand(guest.headers, env(family.data.id), input)).status,
  ).toBe('forbidden');
  const e = env(family.data.id);
  expect((await historyCommand(owner.headers, e, input)).status).toBe(
    'success',
  );
  const visible = await readHistory(guest.headers, family.data.id, {});
  expect(JSON.stringify(visible)).not.toContain('Личный секрет');
  expect(JSON.stringify(visible)).not.toContain(owner.account.id);
  expect(visible.actions.find((a) => a.id === transfer.data.id)!.canEdit).toBe(
    false,
  );
  await db
    .update(financialAccount)
    .set({ archivedAt: new Date() })
    .where(eq(financialAccount.id, owner.account.id));
  expect(
    (await readTransferOptions(owner.headers, family.data.id, true)).find(
      (a) => a.id === owner.account.id,
    ),
  ).toMatchObject({ archived: true });
  expect(
    (
      await historyCommand(owner.headers, env(family.data.id, '2'), {
        ...input,
        debitAmount: '300',
        creditAmount: '300',
      })
    ).status,
  ).toBe('success');
  const [membership] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, family.data.organizationId),
        eq(member.userId, owner.actorId),
      ),
    );
  // Direct fixture revocation preserves one owner and does not bypass command authorization under test.
  await db.transaction(async (tx) => {
    await tx
      .update(member)
      .set({ role: 'member' })
      .where(eq(member.id, membership!.id));
    await tx
      .update(member)
      .set({ role: 'owner' })
      .where(
        and(
          eq(member.organizationId, family.data.organizationId),
          eq(member.userId, guest.actorId),
        ),
      );
    await tx
      .update(workspace)
      .set({ familyOwnerId: guest.actorId })
      .where(eq(workspace.id, family.data.id));
    await tx.delete(member).where(eq(member.id, membership!.id));
  });
  expect((await historyCommand(owner.headers, e, input)).status).toBe(
    'forbidden',
  );
  expect(
    (
      await historyCommand(owner.headers, env(owner.workspaceId, '2'), {
        command: 'delete',
        actionId: transfer.data.id,
        explicitConfirmation: true,
      })
    ).status,
  ).toBe('forbidden');
  expect(
    await db
      .select()
      .from(scopedAuditEvent)
      .where(
        and(
          eq(scopedAuditEvent.objectId, expense.data.id),
          eq(scopedAuditEvent.kind, 'delete'),
        ),
      ),
  ).toHaveLength(1);
});

test('transfer deletion audit failure rolls back whole pair; deleted family blocks both sides', async () => {
  const f = await fixture();
  const family = await createFamily(
    f.headers,
    { name: 'Семья', timezone: 'Europe/Moscow', operationKey: randomUUID() },
    mockMail,
  );
  if (family.status !== 'success') throw Error('FAMILY');
  const dest = await account(f.headers, family.data.id);
  const t = await createTransfer(
    f.headers,
    { workspaceId: f.workspaceId, operationKey: randomUUID() },
    {
      sourceWorkspaceId: f.workspaceId,
      destinationWorkspaceId: family.data.id,
      sourceAccountId: f.account.id,
      destinationAccountId: dest.id,
      debitAmount: '1000',
      creditAmount: '1000',
      financialDate: '2026-10-01',
      sourceDescription: 'Личная сторона',
      destinationDescription: 'Семейная сторона',
    },
  );
  if (t.status !== 'success') throw Error('TRANSFER');
  const trigger = `delete_failure_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${t.data.id}' AND NEW.kind='delete' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  const e = env(f.workspaceId),
    input = {
      command: 'delete',
      actionId: t.data.id,
      explicitConfirmation: true,
    };
  try {
    expect((await historyCommand(f.headers, e, input)).status).toBe(
      'unavailable',
    );
    expect(
      (await readAccounts(f.headers, f.workspaceId)).accounts[0]!.balance,
    ).toBe('8000.00');
    expect(
      (await readAccounts(f.headers, family.data.id)).accounts[0]!.balance,
    ).toBe('11000.00');
    expect(
      await db
        .select()
        .from(actionRevision)
        .where(eq(actionRevision.actionId, t.data.id)),
    ).toHaveLength(1);
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
  expect(
    (
      await familyCommand(
        f.headers,
        env(family.data.id),
        { command: 'delete', explicitConfirmation: true },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect((await historyCommand(f.headers, e, input)).status).toBe('forbidden');
  expect(
    (await historyCommand(f.headers, env(family.data.id), input)).status,
  ).toBe('forbidden');
});
