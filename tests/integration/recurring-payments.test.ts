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
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { categoryCommand } from '@/modules/categories/application/expenses';
import { goalCommand, readGoals } from '@/modules/goals/application/reserve';
import {
  obligationCommand,
  confirmPayment,
  readObligations,
} from '@/modules/obligations/application/recurring-payments';
import { obligationOccurrence } from '@/server/db/schema/recurring-payments';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const envelope = { workspaceId: scope!.id, operationKey: randomUUID() };
  const account = await accountCommand(actor.headers, envelope, {
    command: 'create',
    name: 'Основной',
    type: 'bank_card',
    currency: 'RUB',
    openingBalance: '220000',
  });
  const cat = await categoryCommand(
    actor.headers,
    { ...envelope, operationKey: randomUUID() },
    { command: 'create', kind: 'expense', name: 'Ипотека' },
  );
  if (account.status !== 'success' || cat.status !== 'success')
    throw Error('FIXTURE');
  const input = {
    command: 'create' as const,
    name: 'Ипотека',
    amount: '50000',
    currency: 'RUB',
    repeatEvery: 1,
    repeatUnit: 'month' as const,
    anchorDate: '2027-01-31',
    accountId: account.data.id,
    categoryId: cat.data.id,
  };
  return {
    ...actor,
    envelope: { ...envelope, operationKey: randomUUID() },
    account: account.data,
    input,
  };
}
test('Просмотр не списывает деньги; конкурентная оплата ровно один раз, план и факт раздельны', async () => {
  const f = await fixture();
  const created = await obligationCommand(f.headers, f.envelope, f.input);
  if (created.status !== 'success') throw Error(created.status);
  const before = await readAccounts(f.headers, f.envelope.workspaceId);
  const first = await readObligations(
    f.headers,
    f.envelope.workspaceId,
    '2027-01-01',
    '2027-04-30',
    new Date('2027-04-15T12:00:00Z'),
  );
  expect(
    first.payments.filter((p) => p.obligationId === created.data.id),
  ).toHaveLength(4);
  expect(
    await readObligations(
      f.headers,
      f.envelope.workspaceId,
      '2027-01-01',
      '2027-04-30',
      new Date('2027-04-15T12:00:00Z'),
    ),
  ).toEqual(first);
  expect(await readAccounts(f.headers, f.envelope.workspaceId)).toEqual(before);
  const occurrence = first.payments.find(
    (p) => p.obligationId === created.data.id,
  )!;
  const envelope = { ...f.envelope, operationKey: randomUUID() };
  const pay = {
    occurrenceId: occurrence.id,
    accountId: f.account.id,
    actualAmount: '49000',
    actualDate: '2027-04-15',
  };
  const [a, b] = await Promise.all([
    confirmPayment(f.headers, envelope, pay),
    confirmPayment(f.headers, { ...envelope, operationKey: randomUUID() }, pay),
  ]);
  expect(a.status).toBe('success');
  expect(b.status).toBe('success');
  if (a.status !== 'success' || b.status !== 'success') throw Error('PAY');
  expect(a.data.paymentActionId).toBe(b.data.paymentActionId);
  expect(a.data).toMatchObject({
    scheduledAmount: '50000.00',
    actualAmount: '49000.00',
    actualDate: '2027-04-15',
  });
  expect(
    (await readAccounts(f.headers, f.envelope.workspaceId)).accounts.find(
      (x) => x.id === f.account.id,
    )?.balance,
  ).toBe('171000.00');
});
test('Изменение/пауза сохраняют наступившее, резерв берет актуальную сумму; разрыв и повторная связь', async () => {
  const f = await fixture();
  const r = await obligationCommand(f.headers, f.envelope, {
    ...f.input,
    anchorDate: '2020-01-31',
  });
  if (r.status !== 'success') throw Error(r.status);
  const g = await goalCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID() },
    {
      command: 'create',
      type: 'reserve',
      name: 'Подушка',
      accountId: f.account.id,
      currency: 'RUB',
      monthlyAmount: '1',
      coverageMonths: '12',
    },
  );
  if (g.status !== 'success') throw Error(g.status);
  const link = (id: string | null, version: string) =>
    obligationCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID(), expectedVersion: version },
      { command: 'linkReserve', goalId: g.data.id, obligationId: id },
    );
  expect((await link(r.data.id, '1')).status).toBe('success');
  const changed = await obligationCommand(
    f.headers,
    { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
    {
      ...f.input,
      command: 'update',
      id: r.data.id,
      anchorDate: '2020-01-31',
      amount: '55000',
    },
  );
  expect(changed.status).toBe('success');
  let view = await readGoals(f.headers, f.envelope.workspaceId);
  expect(view.goals[0]?.progress).toMatchObject({
    actual: '220000.00',
    target: '660000.00',
  });
  expect((await link(null, view.goals[0]!.version)).status).toBe('success');
  view = await readGoals(f.headers, f.envelope.workspaceId);
  expect((await link(r.data.id, view.goals[0]!.version)).status).toBe(
    'success',
  );
  expect(
    (
      await obligationCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '2' },
        { command: 'pause', id: r.data.id },
      )
    ).status,
  ).toBe('success');
  view = await readGoals(f.headers, f.envelope.workspaceId);
  expect(view.goals[0]?.progress.target).toBe('660000.00');
});
test('Права, stale версии, чужие счета/категории и rollback при сбое audit', async () => {
  const f = await fixture(),
    other = await fixture();
  expect(
    (await obligationCommand(new Headers(), f.envelope, f.input)).status,
  ).toBe('unauthorized');
  expect(
    (await obligationCommand(other.headers, f.envelope, f.input)).status,
  ).toBe('forbidden');
  expect(
    (
      await obligationCommand(f.headers, f.envelope, {
        ...f.input,
        accountId: other.account.id,
      })
    ).status,
  ).toBe('forbidden');
  const r = await obligationCommand(f.headers, f.envelope, f.input);
  if (r.status !== 'success') throw Error(r.status);
  expect(
    (
      await obligationCommand(
        f.headers,
        { ...f.envelope, operationKey: randomUUID(), expectedVersion: '2' },
        { command: 'pause', id: r.data.id },
      )
    ).status,
  ).toBe('conflict');
  const trigger = `recurring_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='obligation' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect(
      (
        await obligationCommand(
          f.headers,
          { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
          { command: 'pause', id: r.data.id },
        )
      ).status,
    ).toBe('unavailable');
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect(
    (
      await readObligations(
        f.headers,
        f.envelope.workspaceId,
        '2027-01-01',
        '2027-01-31',
      )
    ).obligations[0]?.version,
  ).toBe('1');
  await expect(
    db
      .insert(obligationOccurrence)
      .values({
        workspaceId: other.envelope.workspaceId,
        obligationId: r.data.id,
        scheduledDate: '2027-01-31',
        scheduledAmount: '1',
        currency: 'RUB',
        sourceVersion: 1,
        status: 'planned',
      }),
  ).rejects.toThrow();
});
test('Перепланирование фиксирует due/paid, отменяет future; удаление расхода возвращает план', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-03-15T12:00:00Z'));
  try {
    const f = await fixture();
    const r = await obligationCommand(f.headers, f.envelope, f.input);
    if (r.status !== 'success') throw Error(r.status);
    const first = await readObligations(
      f.headers,
      f.envelope.workspaceId,
      '2027-03-01',
      '2027-05-31',
    );
    const march = first.payments.find((p) => p.scheduledDate === '2027-03-31')!;
    const pay = await confirmPayment(
      f.headers,
      { ...f.envelope, operationKey: randomUUID() },
      {
        occurrenceId: march.id,
        accountId: f.account.id,
        actualAmount: '50000',
        actualDate: '2027-03-15',
      },
    );
    if (pay.status !== 'success') throw Error(pay.status);
    const updated = await obligationCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
      {
        ...f.input,
        command: 'update',
        id: r.data.id,
        anchorDate: '2027-03-20',
        amount: '55000',
      },
    );
    expect(updated.status).toBe('success');
    const next = await readObligations(
      f.headers,
      f.envelope.workspaceId,
      '2027-03-01',
      '2027-05-31',
    );
    expect(
      next.payments
        .filter((p) => p.status === 'planned')
        .map((p) => [p.scheduledDate, p.scheduledAmount]),
    ).toEqual([
      ['2027-01-31', '50000.00'],
      ['2027-02-28', '50000.00'],
      ['2027-03-20', '55000.00'],
      ['2027-04-20', '55000.00'],
      ['2027-05-20', '55000.00'],
    ]);
    expect(next.payments.find((p) => p.id === march.id)).toMatchObject({
      status: 'paid',
      scheduledAmount: '50000.00',
    });
    const { historyCommand } =
      await import('@/modules/ledger/application/history-corrections');
    const removed = await historyCommand(
      f.headers,
      { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
      {
        command: 'delete',
        actionId: pay.data.paymentActionId,
        explicitConfirmation: true,
      },
    );
    expect(removed.status).toBe('success');
    expect(
      (
        await db
          .select()
          .from(obligationOccurrence)
          .where(eq(obligationOccurrence.id, march.id))
      )[0]?.status,
    ).toBe('planned');
  } finally {
    vi.useRealTimers();
  }
});
