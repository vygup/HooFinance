import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor } from './auth-fixture';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import { workspace } from '@/server/db/schema/workspaces';
import { category } from '@/server/db/schema/categories';
import { financialAccount } from '@/server/db/schema/accounts';
import { readSnapshot } from '@/server/db/read-snapshot';

async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  if (!scope) throw new Error('FIXTURE_FAILED');
  return { ...actor, scope };
}
test('Конкурентный повтор команды создаёт один результат; другой payload — conflict', async () => {
  const f = await fixture(),
    operationKey = randomUUID();
  let executions = 0;
  const run = (name: string) =>
    financialTransaction({
      headers: f.headers,
      envelope: { workspaceId: f.scope.id, operationKey },
      payload: { name },
      payloadSchema: z.strictObject({ name: z.string().min(1) }),
      workspaceIds: [f.scope.id],
      accountIds: [],
      execute: async ({ tx, payload }) => {
        executions++;
        const [row] = await tx
          .insert(category)
          .values({
            workspaceId: f.scope.id,
            name: payload.name,
            kind: 'expense',
          })
          .returning();
        if (!row) throw new Error('WRITE_FAILED');
        return { reference: row.id };
      },
      project: async (tx, id) => {
        const [row] = await tx
          .select({ id: category.id, name: category.name })
          .from(category)
          .where(
            and(eq(category.id, id), eq(category.workspaceId, f.scope.id)),
          );
        if (!row) throw new Error('FORBIDDEN');
        return row;
      },
    });
  const [a, b] = await Promise.all([run('Продукты'), run('Продукты')]);
  expect(a.status).toBe('success');
  expect(b).toEqual(a);
  expect(executions).toBe(1);
  expect((await run('Другой payload')).status).toBe('conflict');
});
test('Предупреждение откатывает даже сделанные записи; старое подтверждение не подходит к новой версии', async () => {
  const f = await fixture();
  const [account] = await db
    .insert(financialAccount)
    .values({
      workspaceId: f.scope.id,
      name: 'Счёт',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '10.00',
      balanceProjection: '10.00',
    })
    .returning();
  if (!account) throw new Error('FIXTURE_FAILED');
  const operationKey = randomUUID();
  const run = (confirmationToken?: string) =>
    financialTransaction({
      headers: f.headers,
      envelope: {
        workspaceId: f.scope.id,
        operationKey,
        ...(confirmationToken ? { confirmationToken } : {}),
      },
      payload: { amount: '11.00' },
      payloadSchema: z.strictObject({ amount: z.string() }),
      workspaceIds: [f.scope.id],
      accountIds: [account.id],
      execute: async ({ tx, confirmed }) => {
        await tx
          .update(financialAccount)
          .set({ balanceProjection: '-1.00' })
          .where(eq(financialAccount.id, account.id));
        if (!confirmed)
          return {
            confirmationBalances: [
              { accountId: account.id, amount: '-1.00', currency: 'RUB' },
            ],
          };
        return { reference: account.id };
      },
      project: async (tx, id) => {
        const [row] = await tx
          .select({ balance: financialAccount.balanceProjection })
          .from(financialAccount)
          .where(eq(financialAccount.id, id));
        return row;
      },
    });
  const first = await run();
  expect(first.status).toBe('confirmation_required');
  if (first.status !== 'confirmation_required')
    throw new Error('EXPECTED_CONFIRMATION');
  expect(
    (
      await db
        .select()
        .from(financialAccount)
        .where(eq(financialAccount.id, account.id))
    )[0]?.balanceProjection,
  ).toBe('10.00');
  await db
    .update(financialAccount)
    .set({ version: 2n })
    .where(eq(financialAccount.id, account.id));
  const stale = await run(first.confirmationToken);
  expect(stale.status).toBe('confirmation_required');
  if (stale.status !== 'confirmation_required')
    throw new Error('EXPECTED_CONFIRMATION');
  expect((await run(stale.confirmationToken)).status).toBe('success');
});
test('Queries используют согласованный read-only snapshot', async () => {
  const f = await fixture();
  const [row] = await db
    .insert(category)
    .values({ workspaceId: f.scope.id, name: 'До', kind: 'expense' })
    .returning();
  if (!row) throw new Error('FIXTURE_FAILED');
  await readSnapshot(async (tx) => {
    const first = await tx
      .select()
      .from(category)
      .where(eq(category.id, row.id));
    await db
      .update(category)
      .set({ name: 'После' })
      .where(eq(category.id, row.id));
    const second = await tx
      .select()
      .from(category)
      .where(eq(category.id, row.id));
    expect(second).toEqual(first);
  });
  expect(
    (await db.select().from(category).where(eq(category.id, row.id)))[0]?.name,
  ).toBe('После');
});

test('Повтор receipt не даёт доступа после исключения; deleted family доступна только бывшему владельцу для истории', async () => {
  const { organization, member } = await import('@/server/db/schema/identity');
  const { requireWorkspace } = await import('@/server/security/access');
  const owner = await fixture(),
    participant = await registeredActor();
  const orgId = randomUUID();
  let familyId = '';
  await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({ id: orgId, name: 'Семья', slug: orgId, createdAt: new Date() });
    await tx.insert(member).values([
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: owner.actorId,
        role: 'owner',
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: participant.actorId,
        role: 'member',
        createdAt: new Date(),
      },
    ]);
    const [row] = await tx
      .insert(workspace)
      .values({
        kind: 'family',
        name: 'Семья',
        organizationId: orgId,
        familyOwnerId: owner.actorId,
        timezone: 'Europe/Moscow',
      })
      .returning();
    if (!row) throw new Error('FIXTURE_FAILED');
    familyId = row.id;
  });
  await expect(
    requireWorkspace(participant.actorId, owner.scope.id, 'read', db),
  ).rejects.toThrow('FORBIDDEN');
  const operationKey = randomUUID();
  const run = () =>
    financialTransaction({
      headers: participant.headers,
      envelope: { workspaceId: familyId, operationKey },
      payload: { name: 'Общая категория' },
      payloadSchema: z.strictObject({ name: z.string() }),
      workspaceIds: [familyId],
      accountIds: [],
      execute: async ({ tx, payload }) => {
        const [row] = await tx
          .insert(category)
          .values({
            workspaceId: familyId,
            name: payload.name,
            kind: 'expense',
          })
          .returning();
        if (!row) throw new Error('WRITE_FAILED');
        return { reference: row.id };
      },
      project: async (tx, id) => {
        const [row] = await tx
          .select({ id: category.id })
          .from(category)
          .where(and(eq(category.id, id), eq(category.workspaceId, familyId)));
        return row;
      },
    });
  expect((await run()).status).toBe('success');
  await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, orgId),
        eq(member.userId, participant.actorId),
      ),
    );
  expect((await run()).status).toBe('forbidden');
  await db
    .update(workspace)
    .set({ deletedAt: new Date(), deletedBy: owner.actorId })
    .where(eq(workspace.id, familyId));
  expect(
    (await requireWorkspace(owner.actorId, familyId, 'history', db)).id,
  ).toBe(familyId);
  await expect(
    requireWorkspace(owner.actorId, familyId, 'write', db),
  ).rejects.toThrow('FORBIDDEN');
  await expect(
    requireWorkspace(participant.actorId, familyId, 'history', db),
  ).rejects.toThrow('FORBIDDEN');
});

test('Existing action требует актуальную version; неизвестный и чужой action одинаково закрыты', async () => {
  const { financialAction, actionRevision, ledgerLeg } =
    await import('@/server/db/schema/ledger');
  const f = await fixture();
  const [account] = await db
    .insert(financialAccount)
    .values({
      workspaceId: f.scope.id,
      name: 'Счёт',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '0',
      balanceProjection: '1.00',
    })
    .returning();
  const [cat] = await db
    .insert(category)
    .values({ workspaceId: f.scope.id, name: 'Доход', kind: 'income' })
    .returning();
  if (!account || !cat) throw new Error('FIXTURE_FAILED');
  const actionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(financialAction).values({
      id: actionId,
      creatorId: f.actorId,
      kind: 'income',
      status: 'active',
      currentRevision: 1,
    });
    await tx.insert(actionRevision).values({
      actionId,
      revisionNo: 1,
      actorId: f.actorId,
      status: 'active',
    });
    await tx.insert(ledgerLeg).values({
      workspaceId: f.scope.id,
      actionId,
      revisionNo: 1,
      accountId: account.id,
      currency: 'RUB',
      role: 'income',
      amount: '1.00',
      financialDate: '2026-10-17',
      categoryId: cat.id,
    });
  });
  await db
    .update(financialAccount)
    .set({ archivedAt: new Date() })
    .where(eq(financialAccount.id, account.id));
  const run = (id: string, version: string) =>
    financialTransaction({
      headers: f.headers,
      envelope: {
        workspaceId: f.scope.id,
        operationKey: randomUUID(),
        expectedVersion: version,
      },
      payload: { reason: 'Корректировка' },
      payloadSchema: z.strictObject({ reason: z.string() }),
      workspaceIds: [f.scope.id],
      accountIds: [account.id],
      actionId: id,
      execute: async () => ({ reference: id }),
      project: async (_tx, reference) => ({ id: reference }),
    });
  expect((await run(actionId, '2')).status).toBe('conflict');
  expect((await run(actionId, '1')).status).toBe('success'); // Существующая история архивного счёта сохраняет возможность корректировки.
  expect((await run(randomUUID(), '1')).status).toBe('forbidden');
  const stranger = await fixture();
  const foreign = await financialTransaction({
    headers: stranger.headers,
    envelope: {
      workspaceId: stranger.scope.id,
      operationKey: randomUUID(),
      expectedVersion: '2',
    },
    payload: {},
    payloadSchema: z.strictObject({}),
    workspaceIds: [stranger.scope.id],
    accountIds: [],
    actionId,
    execute: async () => ({ reference: actionId }),
    project: async (_tx, id) => ({ id }),
  });
  expect(foreign.status).toBe('forbidden');
});
