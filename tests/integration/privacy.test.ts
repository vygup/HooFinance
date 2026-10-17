import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import {
  registeredActor,
  integrationDb as db,
  authRequest,
} from './auth-fixture';
import { workspace } from '@/server/db/schema/workspaces';
import { member } from '@/server/db/schema/identity';
import { createFamily } from '@/modules/workspaces/application/family';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { readIncomeAccounts } from '@/modules/ledger/application/income';
import { readGoals } from '@/modules/goals/application/reserve';
import { readMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import {
  readTransfers,
  createTransfer,
} from '@/modules/ledger/application/transfers';
import { projectAccount } from '@/modules/ledger/infrastructure/accounts-repository';
import { projectTransfer } from '@/modules/ledger/infrastructure/transfers-repository';
import { requireWorkspace } from '@/server/security/access';
import { readPrivacy } from '@/modules/workspaces/application/privacy';
import { GET } from '@/app/api/workspaces/[workspaceId]/csv/export/route';
async function fixture() {
  const a = await registeredActor(),
    b = await registeredActor();
  const [personal] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, a.actorId));
  const family = await createFamily(b.headers, {
    name: 'Общая семья',
    operationKey: randomUUID(),
  });
  if (family.status !== 'success') throw Error(family.status);
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, family.data.id));
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: scope!.organizationId!,
    userId: a.actorId,
    role: 'member',
    createdAt: new Date(),
  });
  return { a, b, personal: personal!.id, family: scope! };
}
async function account(headers: Headers, workspaceId: string, name: string) {
  const result = await accountCommand(
    headers,
    { workspaceId, operationKey: randomUUID() },
    {
      command: 'create',
      name,
      type: 'cash',
      currency: 'RUB',
      openingBalance: '10000.01',
    },
  );
  if (result.status !== 'success') throw Error(result.status);
  return result.data.id;
}
test('family owner cannot read member personal views, audit, report, CSV or change foreign ids', async () => {
  const f = await fixture();
  const id = await account(f.a.headers, f.personal, 'Личный секрет');
  for (const read of [
    () => readPrivacy(f.b.headers, { workspaceId: f.personal }),
    () => readAccounts(f.b.headers, f.personal),
    () => readIncomeAccounts(f.b.headers, f.personal, '2026-10'),
    () => readGoals(f.b.headers, f.personal),
    () => readMonthlyBudget(f.b.headers, f.personal, '2026-10', 'RUB'),
    () => readTransfers(f.b.headers, f.personal),
  ])
    await expect(read()).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await accountCommand(
        f.b.headers,
        {
          workspaceId: f.family.id,
          operationKey: randomUUID(),
          expectedVersion: '1',
        },
        {
          command: 'update',
          accountId: id,
          name: 'Подмена',
          type: 'cash',
          description: '',
        },
      )
    ).status,
  ).toBe('forbidden');
  const response = await GET(
    new Request(`http://localhost/api/workspaces/${f.personal}/csv/export`, {
      headers: f.b.headers,
    }),
    { params: Promise.resolve({ workspaceId: f.personal }) },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ status: 'forbidden' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(
    db.transaction((tx) => projectAccount(tx, id, f.family.id, f.b.actorId)),
  ).rejects.toThrow('FORBIDDEN');
  await expect(
    requireWorkspace(f.b.actorId, 'invalid', 'read', db),
  ).rejects.toThrow('FORBIDDEN');
  const auth = await authRequest(
    '/organization/set-active',
    { organizationId: f.personal },
    f.b.headers,
  );
  expect(auth.status).not.toBe(200);
});
test('family transfer and audit reveal only scoped side; revocation denies open form and receipt retry', async () => {
  const f = await fixture();
  const sourceAccountId = await account(
      f.a.headers,
      f.personal,
      'Личный секрет',
    ),
    destinationAccountId = await account(
      f.b.headers,
      f.family.id,
      'Общий счёт',
    );
  const envelope = { workspaceId: f.personal, operationKey: randomUUID() };
  const input = {
    sourceWorkspaceId: f.personal,
    destinationWorkspaceId: f.family.id,
    sourceAccountId,
    destinationAccountId,
    debitAmount: '100.01',
    creditAmount: '100.01',
    financialDate: '2026-10-18',
    sourceDescription: 'Приватный секрет',
    destinationDescription: 'Общий перевод',
  };
  expect((await createTransfer(f.a.headers, envelope, input)).status).toBe(
    'success',
  );
  const transfer = await readTransfers(f.b.headers, f.family.id);
  await expect(
    db.transaction((tx) =>
      projectTransfer(tx, transfer[0]!.id, f.personal, f.b.actorId),
    ),
  ).rejects.toThrow('FORBIDDEN');
  expect(transfer[0]!.legs).toHaveLength(1);
  expect(transfer[0]!.legs[0]!.amount).toBe('100.01');
  const view = JSON.stringify(
    await readIncomeAccounts(f.b.headers, f.family.id, '2026-10'),
  );
  for (const secret of [sourceAccountId, 'Личный секрет', 'Приватный секрет'])
    expect(view).not.toContain(secret);
  await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, f.family.organizationId!),
        eq(member.userId, f.a.actorId),
      ),
    );
  await expect(readAccounts(f.a.headers, f.family.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect((await createTransfer(f.a.headers, envelope, input)).status).toBe(
    'forbidden',
  );
  expect(
    (
      await createTransfer(
        f.a.headers,
        { ...envelope, operationKey: randomUUID() },
        input,
      )
    ).status,
  ).toBe('forbidden');
  expect(
    (await readAccounts(f.b.headers, f.family.id)).accounts[0]!.balance,
  ).toBe('10100.02');
});
test('anonymous and malformed reads fail closed without database details', async () => {
  const f = await fixture();
  await expect(
    readPrivacy(new Headers(), { workspaceId: f.personal }),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(
    readPrivacy(f.a.headers, { workspaceId: 'invalid' }),
  ).rejects.toThrow('FORBIDDEN');
  const response = await GET(new Request('http://localhost/export'), {
    params: Promise.resolve({ workspaceId: f.personal }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ status: 'unauthorized' });
});
