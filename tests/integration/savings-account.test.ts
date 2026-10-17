import { randomUUID } from 'node:crypto';
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
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { createIncome } from '@/modules/ledger/application/income';
import { createExpense } from '@/modules/ledger/application/expenses';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import { readSavingsAccount } from '@/modules/goals/application/savings-account';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  return {
    ...actor,
    workspaceId: scope!.id,
    envelope: () => ({ workspaceId: scope!.id, operationKey: randomUUID() }),
  };
}
test('US8: savings220000 counted once; pre-goal ledger and opening survive linking; second active goal conflicts', async () => {
  const f = await fixture();
  const a = await accountCommand(f.headers, f.envelope(), {
    command: 'create',
    name: 'Подушка',
    type: 'accumulation',
    currency: 'RUB',
    openingBalance: '203000',
  });
  if (a.status !== 'success') throw Error(a.status);
  for (const [execute, amount] of [
    [createIncome, '20000'],
    [createExpense, '3000'],
  ] as const)
    expect(
      (
        await execute(f.headers, f.envelope(), {
          accountId: a.data.id,
          category: { name: 'До цели' },
          amount,
          financialDate: '2026-10-01',
        })
      ).status,
    ).toBe('success');
  const before = await readSavingsAccount(f.headers, f.workspaceId, {
    accountId: a.data.id,
  });
  expect(before).toMatchObject({
    openingBalance: '203000.00',
    balance: '220000.00',
    type: 'accumulation',
  });
  expect(before.history).toHaveLength(2);
  const input = {
    command: 'create',
    type: 'reserve',
    name: 'Ипотека',
    accountId: a.data.id,
    currency: 'RUB',
    monthlyAmount: '50000',
    coverageMonths: '12',
  };
  const envelope = f.envelope(),
    r = await goalCommand(f.headers, envelope, input);
  if (r.status !== 'success') throw Error(r.status);
  expect(await goalCommand(f.headers, envelope, input)).toEqual(r);
  expect(r.data.progress.actual).toBe('220000.00');
  expect((await readAccounts(f.headers, f.workspaceId)).totals).toEqual([
    { currency: 'RUB', amount: '220000.00' },
  ]);
  expect(
    await readSavingsAccount(f.headers, f.workspaceId, {
      accountId: a.data.id,
    }),
  ).toEqual(before);
  expect(
    (await readGoals(f.headers, f.workspaceId)).accounts.find(
      (c) => c.id === a.data.id,
    ),
  ).toMatchObject({
    type: 'accumulation',
    balance: '220000.00',
    occupied: true,
  });
  expect(
    (
      await goalCommand(f.headers, f.envelope(), {
        command: 'create',
        type: 'ordinary',
        name: 'Вторая',
        accountId: a.data.id,
        currency: 'RUB',
        ordinaryTarget: '100000',
      })
    ).status,
  ).toBe('conflict');
  expect((await readGoals(f.headers, f.workspaceId)).goals).toHaveLength(1);
  expect(
    await readSavingsAccount(f.headers, f.workspaceId, {
      accountId: a.data.id,
    }),
  ).toEqual(before);
});
test('picker history denies foreign account/scope, unauthenticated and malformed input; zero/negative balances and archived history persist', async () => {
  const f = await fixture(),
    other = await fixture();
  const a = await accountCommand(f.headers, f.envelope(), {
    command: 'create',
    name: 'Нулевой',
    type: 'savings',
    currency: 'RUB',
    openingBalance: '0',
  });
  if (a.status !== 'success') throw Error(a.status);
  const read = (headers = f.headers, workspaceId = f.workspaceId) =>
    readSavingsAccount(headers, workspaceId, { accountId: a.data.id });
  expect((await read()).balance).toBe('0.00');
  await expect(read(other.headers)).rejects.toThrow('FORBIDDEN');
  await expect(read(f.headers, other.workspaceId)).rejects.toThrow('FORBIDDEN');
  await expect(read(new Headers())).rejects.toThrow('UNAUTHORIZED');
  await expect(
    readSavingsAccount(f.headers, f.workspaceId, { accountId: 'bad' }),
  ).rejects.toThrow();
  const e = f.envelope();
  const warning = await accountCommand(
    f.headers,
    { ...e, expectedVersion: '1' },
    {
      command: 'correctOpening',
      accountId: a.data.id,
      openingBalance: '-5000',
      explicitConfirmation: true,
    },
  );
  if (warning.status !== 'confirmation_required') throw Error(warning.status);
  expect(
    (
      await accountCommand(
        f.headers,
        {
          ...e,
          expectedVersion: '1',
          confirmationToken: warning.confirmationToken,
        },
        {
          command: 'correctOpening',
          accountId: a.data.id,
          openingBalance: '-5000',
          explicitConfirmation: true,
        },
      )
    ).status,
  ).toBe('success');
  expect((await read()).balance).toBe('-5000.00');
  expect(
    (
      await accountCommand(
        f.headers,
        { ...f.envelope(), expectedVersion: '2' },
        { command: 'archive', accountId: a.data.id },
      )
    ).status,
  ).toBe('success');
  expect(await read()).toMatchObject({ balance: '-5000.00', archived: true });
});

test('two concurrent goals cannot claim the same savings account; failed claim never changes history', async () => {
  const f = await fixture();
  const a = await accountCommand(f.headers, f.envelope(), {
    command: 'create',
    name: 'Общий резерв',
    type: 'savings',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (a.status !== 'success') throw Error(a.status);
  const before = await readSavingsAccount(f.headers, f.workspaceId, {
    accountId: a.data.id,
  });
  const input = {
    command: 'create',
    type: 'ordinary',
    accountId: a.data.id,
    currency: 'RUB',
    ordinaryTarget: '100000',
  };
  const results = await Promise.all(
    ['Первая', 'Вторая'].map((name) =>
      goalCommand(f.headers, f.envelope(), { ...input, name }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  expect((await readGoals(f.headers, f.workspaceId)).goals).toHaveLength(1);
  expect(
    await readSavingsAccount(f.headers, f.workspaceId, {
      accountId: a.data.id,
    }),
  ).toEqual(before);
});
