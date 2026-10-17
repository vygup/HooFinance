import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import {
  commandReceipt,
  ledgerLeg,
  scopedAuditEvent,
  actionRevision,
} from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import {
  createExpense,
  readExpenses,
} from '@/modules/ledger/application/expenses';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const envelope = { workspaceId: scope!.id, operationKey: randomUUID() };
  const account = await accountCommand(actor.headers, envelope, {
    command: 'create',
    name: 'Банк',
    type: 'bank_card',
    currency: 'RUB',
    openingBalance: '120000',
  });
  if (account.status !== 'success') throw new Error('FIXTURE');
  const input = {
    accountId: account.data.id,
    category: { name: 'Зарплата' },
    amount: '3000',
    financialDate: '2026-10-17',
    description: 'Поступление',
  };
  return {
    ...actor,
    envelope: { ...envelope, operationKey: randomUUID() },
    input,
    account: account.data,
  };
}
test('concurrent same key: one effect, revision/audit/category/receipt; separate keys intentional duplicate; period excludes opening', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    createExpense(f.headers, f.envelope, f.input),
    createExpense(f.headers, f.envelope, f.input),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe('success');
  if (a.status !== 'success') throw new Error('SUCCESS');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0],
  ).toMatchObject({ balance: '117000.00', version: '2' });
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.accountId, f.account.id)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(actionRevision)
      .where(eq(actionRevision.actionId, a.data.id)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(scopedAuditEvent)
      .where(eq(scopedAuditEvent.objectId, a.data.id)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(category)
      .where(eq(category.workspaceId, f.envelope.workspaceId)),
  ).toHaveLength(1);
  expect(
    (await readExpenses(f.headers, f.envelope.workspaceId, '2026-10')).totals,
  ).toEqual([{ currency: 'RUB', amount: '3000.00' }]);
  expect(
    (await readExpenses(f.headers, f.envelope.workspaceId, '2026-09')).totals,
  ).toEqual([]);
  expect(
    (await createExpense(f.headers, f.envelope, { ...f.input, amount: '1' }))
      .status,
  ).toBe('conflict');
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        { ...f.input, category: { id: a.data.categoryId } },
      )
    ).status,
  ).toBe('success');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0]
      ?.balance,
  ).toBe('114000.00');
});
test('invalid amount/date/currency, expense/archived/foreign category, foreign account and missing session never write', async () => {
  const f = await fixture(),
    other = await fixture();
  const run = (input: unknown, headers = f.headers) =>
    createExpense(
      headers,
      { ...f.envelope, operationKey: randomUUID() },
      input,
    );
  for (const patch of [
    { amount: '0' },
    { amount: '-1' },
    { amount: '1.001' },
    { financialDate: '2026-02-30' },
    { currency: 'USD' },
  ])
    expect((await run({ ...f.input, ...patch })).status).toBe('validation');
  for (const values of [
    { workspaceId: f.envelope.workspaceId, kind: 'income', archivedAt: null },
    {
      workspaceId: f.envelope.workspaceId,
      kind: 'expense',
      archivedAt: new Date(),
    },
    {
      workspaceId: other.envelope.workspaceId,
      kind: 'expense',
      archivedAt: null,
    },
  ]) {
    const [c] = await db
      .insert(category)
      .values({ ...values, name: 'Категория' })
      .returning();
    expect((await run({ ...f.input, category: { id: c!.id } })).status).toBe(
      'forbidden',
    );
  }
  expect((await run({ ...f.input, accountId: other.account.id })).status).toBe(
    'forbidden',
  );
  expect((await run(f.input, other.headers)).status).toBe('forbidden');
  expect((await run(f.input, new Headers())).status).toBe('unauthorized');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0]
      ?.balance,
  ).toBe('120000.00');
  await expect(
    readExpenses(other.headers, f.envelope.workspaceId, '2026-10'),
  ).rejects.toThrow('FORBIDDEN');
  await db
    .update(financialAccount)
    .set({ archivedAt: new Date() })
    .where(eq(financialAccount.id, f.account.id));
  expect((await run(f.input)).status).toBe('forbidden');
});
test('audit failure rolls back category, ledger, balance/version and receipt; retry succeeds', async () => {
  const f = await fixture();
  const trigger = `income_failure_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id = '${f.envelope.workspaceId}' AND NEW.object_type = 'expense' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await createExpense(f.headers, f.envelope, f.input)).status).toBe(
      'unavailable',
    );
    expect(
      await db
        .select()
        .from(category)
        .where(eq(category.workspaceId, f.envelope.workspaceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(ledgerLeg)
        .where(eq(ledgerLeg.accountId, f.account.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, f.envelope.operationKey)),
    ).toHaveLength(0);
    expect(
      (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0],
    ).toMatchObject({ balance: '120000.00', version: '1' });
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await createExpense(f.headers, f.envelope, f.input)).status).toBe(
    'success',
  );
});

test('month boundaries and currencies: no conversion, active current revision only', async () => {
  const f = await fixture();
  const yen = await accountCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    {
      command: 'create',
      name: 'JPY',
      type: 'cash',
      currency: 'JPY',
      openingBalance: '100',
    },
  );
  if (yen.status !== 'success') throw new Error('ACCOUNT_FIXTURE');
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        { ...f.input, accountId: yen.data.id, amount: '1.1' },
      )
    ).status,
  ).toBe('validation');
  for (const [financialDate, accountId, amount] of [
    ['2026-10-01', f.account.id, '1'],
    ['2026-10-31', f.account.id, '2'],
    ['2026-11-01', f.account.id, '4'],
    ['2026-10-17', yen.data.id, '10'],
  ]) {
    expect(
      (
        await createExpense(
          f.headers,
          { ...f.envelope, operationKey: randomUUID() },
          { ...f.input, financialDate, accountId, amount },
        )
      ).status,
    ).toBe('success');
  }
  expect(
    (await readExpenses(f.headers, f.envelope.workspaceId, '2026-10')).totals,
  ).toEqual([
    { currency: 'JPY', amount: '10' },
    { currency: 'RUB', amount: '3.00' },
  ]);
});

test('warning decline, stale confirmation, confirm and replay; category CRUD/archive preserves legs', async () => {
  const f = await fixture();
  const { categoryCommand, readCategories } =
    await import('@/modules/categories/application/expenses');
  const cat = await categoryCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    { command: 'create', name: 'Продукты', kind: 'expense' },
  );
  expect(cat.status).toBe('success');
  if (cat.status !== 'success') throw Error('FIXTURE');
  const input = { ...f.input, amount: '121500', category: { id: cat.data.id } };
  const warning = await createExpense(f.headers, f.envelope, input);
  expect(warning.status).toBe('confirmation_required');
  if (warning.status !== 'confirmation_required') throw Error('WARNING');
  expect(warning.balances[0]?.amount).toBe('-1500.00');
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0]
      ?.balance,
  ).toBe('120000.00');
  await createExpense(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    { ...f.input, amount: '1' },
  );
  const stale = await createExpense(
    f.headers,
    { ...f.envelope, confirmationToken: warning.confirmationToken },
    input,
  );
  expect(stale.status).toBe('confirmation_required');
  if (stale.status !== 'confirmation_required') throw Error('WARNING');
  const confirmed = {
    ...f.envelope,
    confirmationToken: stale.confirmationToken,
  };
  const result = await createExpense(f.headers, confirmed, input);
  expect(result.status).toBe('success');
  expect(await createExpense(f.headers, confirmed, input)).toEqual(result);
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts[0]
      ?.balance,
  ).toBe('-1501.00');
  const rename = await categoryCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
    { command: 'update', id: cat.data.id, name: 'Еда' },
  );
  expect(rename.status).toBe('success');
  expect(
    (
      await categoryCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
        { command: 'archive', id: cat.data.id },
      )
    ).status,
  ).toBe('conflict');
  expect(
    (
      await categoryCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '2' },
        { command: 'archive', id: cat.data.id },
      )
    ).status,
  ).toBe('success');
  expect(
    (await readCategories(f.headers, f.envelope.workspaceId)).find(
      (c) => c.id === cat.data.id,
    ),
  ).toMatchObject({ name: 'Еда', archived: true, version: '3' });
  expect(
    (
      await createExpense(
        f.headers,
        { ...f.envelope, operationKey: randomUUID() },
        input,
      )
    ).status,
  ).toBe('forbidden');
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.categoryId, cat.data.id)),
  ).toHaveLength(1);
});

test('family member income; revoked membership denies replay/read, deleted family denies writes', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand, respondFamilyInvitation } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { invitation, member } = await import('@/server/db/schema/identity');
  const { encryptToken } = await import('@/server/security/encryption');
  const { and } = await import('drizzle-orm');
  const r = await createFamily(
    owner.headers,
    {
      name: 'Общие доходы',
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    },
    mockMail,
  );
  if (r.status !== 'success') throw new Error('FAMILY_FIXTURE');
  const family = r.data;
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
  const [inv] = await db
    .select()
    .from(invitation)
    .where(eq(invitation.organizationId, family.organizationId));
  expect(
    (
      await respondFamilyInvitation(guest.headers, {
        secret: encryptToken(inv!.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('success');
  const a = await accountCommand(
    owner.headers,
    { workspaceId: family.id, operationKey: randomUUID() },
    {
      command: 'create',
      name: 'Общий',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '500',
    },
  );
  if (a.status !== 'success') throw new Error('ACCOUNT_FIXTURE');
  const e = { workspaceId: family.id, operationKey: randomUUID() };
  const input = { ...guest.input, accountId: a.data.id, amount: '1' };
  expect((await createExpense(guest.headers, e, input)).status).toBe('success');
  expect(
    (await readAccounts(owner.headers, family.id)).accounts[0]?.balance,
  ).toBe('499.00');
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
  expect((await createExpense(guest.headers, e, input)).status).toBe(
    'forbidden',
  );
  await expect(
    readExpenses(guest.headers, family.id, '2026-10'),
  ).rejects.toThrow('FORBIDDEN');
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
      await createExpense(
        owner.headers,
        { ...e, operationKey: randomUUID() },
        input,
      )
    ).status,
  ).toBe('forbidden');
});

test('category isolation, both types, empty states and per-category expense fact', async () => {
  const f = await fixture(),
    other = await fixture();
  const { categoryCommand, readCategories } =
    await import('@/modules/categories/application/expenses');
  expect(await readCategories(f.headers, f.envelope.workspaceId)).toEqual([]);
  for (const kind of ['income', 'expense']) {
    const r = await categoryCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID() },
      { command: 'create', kind, name: 'Категория' },
    );
    expect(r.status).toBe('success');
    if (r.status !== 'success') throw Error('FIXTURE');
    expect(
      (
        await categoryCommand(
          other.headers,
          { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
          { command: 'update', id: r.data.id, name: 'Чужая' },
        )
      ).status,
    ).toBe('forbidden');
    expect(
      (
        await categoryCommand(
          other.headers,
          {
            ...other.envelope,
            operationKey: randomUUID(),
            expectedVersion: '1',
          },
          { command: 'archive', id: r.data.id },
        )
      ).status,
    ).toBe('forbidden');
    if (kind === 'expense') {
      expect(
        (
          await createExpense(f.headers, f.envelope, {
            ...f.input,
            category: { id: r.data.id },
          })
        ).status,
      ).toBe('success');
      expect(
        (await readExpenses(f.headers, f.envelope.workspaceId, '2026-10'))
          .byCategory,
      ).toEqual([
        {
          categoryId: r.data.id,
          totals: [{ currency: 'RUB', amount: '3000.00' }],
        },
      ]);
    }
  }
});
