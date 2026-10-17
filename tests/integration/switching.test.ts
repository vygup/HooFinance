import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { registeredActor, integrationDb as db } from './auth-fixture';
import {
  createFamily,
  familyCommand,
} from '@/modules/workspaces/application/family';
import {
  readSpaces,
  selectSpace,
  setFamilyTimezone,
} from '@/modules/workspaces/application/switching';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { workspace } from '@/server/db/schema/workspaces';
import { member, userProfile } from '@/server/db/schema/identity';
import {
  createIncome,
  readIncomeAccounts,
} from '@/modules/ledger/application/income';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import {
  saveMonthlyBudget,
  readMonthlyBudget,
} from '@/modules/budgeting/application/monthly-budget';
import { scopedAuditEvent, ledgerLeg } from '@/server/db/schema/ledger';
test('personal + two families: explicit selection, isolation, forged scope, revoked membership and deleted owner', async () => {
  const a = await registeredActor(),
    b = await registeredActor();
  for (const name of ['Первая', 'Вторая']) {
    const r = await createFamily(a.headers, {
      name,
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    });
    expect(r.status).toBe('success');
  }
  const spaces = await readSpaces(a.headers);
  expect(spaces.active).toHaveLength(3);
  for (const [i, space] of spaces.active.entries()) {
    const r = await accountCommand(
      a.headers,
      { workspaceId: space.id, operationKey: randomUUID() },
      {
        command: 'create',
        name: `Счёт ${i}`,
        type: 'accumulation',
        currency: 'RUB',
        openingBalance: `${i}.01`,
      },
    );
    expect(r.status).toBe('success');
    const selected = await selectSpace(a.headers, {
      workspaceId: space.id,
      section: 'accounts',
    });
    expect(selected.id).toBe(space.id);
    const accounts = await readAccounts(a.headers, space.id);
    expect(accounts.accounts.map((x) => x.name)).toEqual([`Счёт ${i}`]);
    expect(accounts.accounts[0]!.balance).toBe(`${i}.01`);
    if (r.status !== 'success') throw Error(r.status);
    const envelope = () => ({
      workspaceId: space.id,
      operationKey: randomUUID(),
    });
    expect(
      (
        await createIncome(a.headers, envelope(), {
          accountId: r.data.id,
          category: { name: `Доход ${i}` },
          amount: '10.01',
          financialDate: '2026-10-31',
          description: `Запись ${i}`,
        })
      ).status,
    ).toBe('success');
    expect(
      (
        await goalCommand(a.headers, envelope(), {
          command: 'create',
          type: 'ordinary',
          name: `Цель ${i}`,
          accountId: r.data.id,
          currency: 'RUB',
          ordinaryTarget: '100',
        })
      ).status,
    ).toBe('success');
    expect(
      (
        await saveMonthlyBudget(a.headers, envelope(), {
          month: '2026-10',
          currency: 'RUB',
          plannedIncome: `${i}.01`,
          categoryLimits: [],
        })
      ).status,
    ).toBe('success');
    const view = await readIncomeAccounts(a.headers, space.id, '2026-10');
    expect(view.accounts.map((x) => x.name)).toEqual([`Счёт ${i}`]);
    expect(view.accounts[0]!.history.map((x) => x.description)).toEqual([
      `Запись ${i}`,
    ]);
    expect(view.income.categories.map((x) => x.name)).toEqual([`Доход ${i}`]);
    expect(
      (await readGoals(a.headers, space.id)).goals.map((x) => x.name),
    ).toEqual([`Цель ${i}`]);
    expect(
      (await readMonthlyBudget(a.headers, space.id, '2026-10', 'RUB')).budget
        ?.plannedIncome,
    ).toBe(`${i}.01`);

    await expect(
      selectSpace(b.headers, { workspaceId: space.id, section: 'accounts' }),
    ).rejects.toThrow('FORBIDDEN');
  }
  const family = spaces.active.find((s) => s.kind === 'family')!;
  const [row] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, family.id));
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: row!.organizationId!,
    userId: b.actorId,
    role: 'member',
    createdAt: new Date(),
  });
  await db
    .update(userProfile)
    .set({ timezone: 'America/Los_Angeles' })
    .where(eq(userProfile.userId, b.actorId));
  const instant = new Date('2026-10-31T22:30:00Z');
  expect(
    (
      await selectSpace(
        a.headers,
        { workspaceId: family.id, section: 'budget' },
        instant,
      )
    ).month,
  ).toBe('2026-11');
  expect(
    (
      await selectSpace(
        b.headers,
        { workspaceId: family.id, section: 'budget' },
        instant,
      )
    ).month,
  ).toBe('2026-11');
  const env = {
    workspaceId: family.id,
    operationKey: randomUUID(),
    expectedVersion: '1',
  };
  expect(
    (await setFamilyTimezone(b.headers, env, { timezone: 'Asia/Tokyo' }))
      .status,
  ).toBe('forbidden');
  const historyBefore = await db
    .select()
    .from(ledgerLeg)
    .where(eq(ledgerLeg.workspaceId, family.id));
  expect(
    (await setFamilyTimezone(a.headers, env, { timezone: 'Asia/Tokyo' }))
      .status,
  ).toBe('success');
  expect(
    (
      await setFamilyTimezone(
        a.headers,
        { ...env, operationKey: randomUUID() },
        { timezone: 'UTC' },
      )
    ).status,
  ).toBe('conflict');
  expect(
    await db
      .select()
      .from(ledgerLeg)
      .where(eq(ledgerLeg.workspaceId, family.id)),
  ).toEqual(historyBefore);
  const audits = await db
    .select()
    .from(scopedAuditEvent)
    .where(
      and(
        eq(scopedAuditEvent.workspaceId, family.id),
        eq(scopedAuditEvent.kind, 'timezone'),
      ),
    );
  expect(audits).toHaveLength(1);
  expect(audits[0]!.afterScope).toMatchObject({
    timezone: 'Asia/Tokyo',
    version: '2',
  });
  await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, row!.organizationId!),
        eq(member.userId, b.actorId),
      ),
    );
  await expect(
    selectSpace(b.headers, { workspaceId: family.id, section: 'accounts' }),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await familyCommand(
        a.headers,
        { ...env, operationKey: randomUUID(), expectedVersion: '2' },
        { command: 'delete', explicitConfirmation: true },
      )
    ).status,
  ).toBe('success');
  expect((await readSpaces(a.headers)).deleted.map((s) => s.id)).toContain(
    family.id,
  );
  expect(
    (
      await selectSpace(a.headers, {
        workspaceId: family.id,
        section: 'accounts',
      })
    ).readonly,
  ).toBe(true);
  await expect(
    selectSpace(b.headers, { workspaceId: family.id, section: 'accounts' }),
  ).rejects.toThrow('FORBIDDEN');
});

test('selection denies missing session and malformed input, timezone validates before mutation', async () => {
  const a = await registeredActor();
  const space = (await readSpaces(a.headers)).active[0]!;
  await expect(
    selectSpace(new Headers(), { workspaceId: space.id, section: 'accounts' }),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(
    selectSpace(a.headers, { workspaceId: '../invalid', section: 'accounts' }),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await setFamilyTimezone(
        a.headers,
        {
          workspaceId: space.id,
          operationKey: randomUUID(),
          expectedVersion: '1',
        },
        { timezone: 'invalid' },
      )
    ).status,
  ).toBe('validation');
});

test('new family initially inherits owner profile timezone', async () => {
  const a = await registeredActor();
  await db
    .update(userProfile)
    .set({ timezone: 'Asia/Tokyo' })
    .where(eq(userProfile.userId, a.actorId));
  const family = await createFamily(a.headers, {
    name: 'Пояс владельца',
    operationKey: randomUUID(),
  });
  if (family.status !== 'success') throw Error(family.status);
  expect(family.data.timezone).toBe('Asia/Tokyo');
});
