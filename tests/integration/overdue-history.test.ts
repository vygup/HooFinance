import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { registeredActor, integrationDb as db } from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { category } from '@/server/db/schema/categories';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  obligation,
  obligationOccurrence,
} from '@/server/db/schema/recurring-payments';
import { obligationScheduleRevision } from '@/server/db/schema/obligation-schedule';
import { materializePayments } from '@/modules/obligations/infrastructure/schedule-history-repository';
test('Январская история восстанавливается при первом запросе в апреле без повторных экземпляров', async () => {
  const actor = await registeredActor();
  const [w] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const [a] = await db
    .insert(financialAccount)
    .values({
      workspaceId: w!.id,
      name: 'Счет',
      type: 'current',
      currency: 'RUB',
      openingBalance: '220000',
      balanceProjection: '220000',
    })
    .returning();
  const [c] = await db
    .insert(category)
    .values({ workspaceId: w!.id, name: 'Ипотека', kind: 'expense' })
    .returning();
  const [o] = await db
    .insert(obligation)
    .values({
      workspaceId: w!.id,
      name: 'Ипотека',
      amount: '50000',
      currency: 'RUB',
      repeatEvery: 1,
      repeatUnit: 'month',
      anchorDate: '2027-01-31',
      anchorDay: 31,
      categoryId: c!.id,
      accountId: a!.id,
    })
    .returning();
  await db.insert(obligationScheduleRevision).values({
    workspaceId: w!.id,
    obligationId: o!.id,
    revisionNo: 1,
    anchorDate: '2027-01-31',
    anchorDay: 31,
    repeatEvery: 1,
    repeatUnit: 'month',
    amount: '50000',
    currency: 'RUB',
    activeFrom: '2027-01-31',
    status: 'active',
  });
  for (let i = 0; i < 2; i++)
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(workspace)
        .where(eq(workspace.id, w!.id))
        .for('update');
      await materializePayments(
        tx,
        w!.id,
        o!.id,
        '2027-04-01',
        '2027-04-30',
        '2027-04-15',
      );
    });
  const rows = await db
    .select()
    .from(obligationOccurrence)
    .where(eq(obligationOccurrence.obligationId, o!.id))
    .orderBy(obligationOccurrence.scheduledDate);
  expect(rows.map((p) => p.scheduledDate)).toEqual([
    '2027-01-31',
    '2027-02-28',
    '2027-03-31',
    '2027-04-30',
  ]);
  expect(
    rows.every((p) => p.status === 'planned' && p.paymentActionId === null),
  ).toBe(true);
  await expect(
    db
      .update(obligationScheduleRevision)
      .set({ amount: '1' })
      .where(eq(obligationScheduleRevision.obligationId, o!.id)),
  ).rejects.toThrow();
});
