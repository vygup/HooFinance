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
import { commandReceipt, scopedAuditEvent } from '@/server/db/schema/ledger';
import {
  accountCommand,
  readAccounts,
} from '@/modules/ledger/application/accounts';
import { goalCommand } from '@/modules/goals/application/reserve';
async function fixture() {
  const actor = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, actor.actorId));
  const envelope = { workspaceId: scope!.id, operationKey: randomUUID() };
  const result = await accountCommand(actor.headers, envelope, {
    command: 'create',
    name: 'Подушка',
    type: 'accumulation',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (result.status !== 'success') throw Error(result.status);
  return {
    ...actor,
    envelope: { ...envelope, operationKey: randomUUID() },
    account: result.data,
    input: {
      command: 'create' as const,
      type: 'reserve' as const,
      name: 'Ипотечная подушка',
      accountId: result.data.id,
      currency: 'RUB',
      monthlyAmount: '50000',
      coverageMonths: '12',
    },
  };
}

import {
  configureSavings,
  previewSavings,
  readSavingsPlan,
} from '@/modules/goals/application/savings-plan';
import { todayInTimezone, occurrenceDate } from '@/shared/calendar/calendar';
async function reserveFixture() {
  const f = await fixture();
  const created = await goalCommand(f.headers, f.envelope, f.input);
  if (created.status !== 'success') throw Error(created.status);
  return {
    ...f,
    reserve: created.data,
    adjustment: {
      command: 'adjustReserve' as const,
      goalId: created.data.id,
      monthlyAmount: '55000',
      coverageMonths: '12',
    },
    edit: { ...f.envelope, operationKey: randomUUID(), expectedVersion: '1' },
  };
}
test('plan configure/replay/version/audit without financial effect and scoped reads', async () => {
  const f = await reserveFixture(),
    other = await reserveFixture();
  const before = await readAccounts(f.headers, f.envelope.workspaceId);
  const today = todayInTimezone('Europe/Moscow');
  const input = {
    command: 'configureSavings',
    goalId: f.reserve.id,
    anchorDate: today,
    monthlyContribution: '30000',
  };
  const envelope = { ...f.edit, expectedVersion: undefined };
  const results = await Promise.all([
    configureSavings(f.headers, envelope, input),
    configureSavings(f.headers, envelope, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    status: 'success',
    data: { version: '1', monthlyContribution: '30000.00' },
  });
  expect(await readAccounts(f.headers, f.envelope.workspaceId)).toEqual(before);
  expect((await configureSavings(other.headers, envelope, input)).status).toBe(
    'forbidden',
  );
  expect((await configureSavings(new Headers(), envelope, input)).status).toBe(
    'unauthorized',
  );
  await expect(
    readSavingsPlan(other.headers, f.envelope.workspaceId, f.reserve.id),
  ).rejects.toThrow('FORBIDDEN');
  expect(
    (
      await configureSavings(
        f.headers,
        { ...envelope, operationKey: randomUUID() },
        input,
      )
    ).status,
  ).toBe('conflict');
  expect(
    (
      await configureSavings(f.headers, envelope, {
        ...input,
        monthlyContribution: '1',
      })
    ).status,
  ).toBe('conflict');
  for (const patch of [
    { monthlyContribution: '1.001' },
    { anchorDate: '2000-01-01' },
    { monthlyContribution: '-1' },
  ])
    expect(
      (
        await configureSavings(
          f.headers,
          { ...envelope, operationKey: randomUUID(), expectedVersion: '1' },
          { ...input, ...patch },
        )
      ).status,
    ).toBe('validation');
  const updated = await configureSavings(
    f.headers,
    { ...envelope, operationKey: randomUUID(), expectedVersion: '1' },
    {
      ...input,
      anchorDate: occurrenceDate(today, 1, 'month'),
      monthlyContribution: '0',
    },
  );
  expect(updated).toMatchObject({
    status: 'success',
    data: { version: '2', projection: { forecastDate: null } },
  });
  const audits = await db
    .select()
    .from(scopedAuditEvent)
    .where(eq(scopedAuditEvent.objectId, f.reserve.id));
  expect(audits.filter((a) => a.objectType === 'savings_plan')).toHaveLength(2);
});
test('audit failure rolls back configuration and receipt; same key can retry', async () => {
  const f = await reserveFixture();
  const envelope = { ...f.edit, expectedVersion: undefined };
  const input = {
    command: 'configureSavings',
    goalId: f.reserve.id,
    anchorDate: todayInTimezone('Europe/Moscow'),
    monthlyContribution: '30000',
  };
  const trigger = `savings_fail_${randomUUID().replaceAll('-', '')}`;
  await db.execute(
    sql.raw(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${f.reserve.id}' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON scoped_audit_event FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    ),
  );
  try {
    expect((await configureSavings(f.headers, envelope, input)).status).toBe(
      'unavailable',
    );
    expect(
      (await readSavingsPlan(f.headers, f.envelope.workspaceId, f.reserve.id))
        .version,
    ).toBe('0');
    expect(
      await db
        .select()
        .from(commandReceipt)
        .where(eq(commandReceipt.operationKey, envelope.operationKey)),
    ).toHaveLength(0);
  } finally {
    await db.execute(
      sql.raw(
        `DROP TRIGGER ${trigger} ON scoped_audit_event; DROP FUNCTION ${trigger}()`,
      ),
    );
  }
  expect((await configureSavings(f.headers, envelope, input)).status).toBe(
    'success',
  );
});

test('family plan edits, concurrent versions, revoked replay and deleted family', async () => {
  const owner = await fixture(),
    guest = await fixture();
  const { createFamily, familyCommand } =
    await import('@/modules/workspaces/application/family');
  const { mockMail } = await import('./auth-fixture');
  const { member } = await import('@/server/db/schema/identity');
  const family = await createFamily(
    owner.headers,
    {
      name: 'Резерв семьи',
      timezone: 'Europe/Moscow',
      operationKey: randomUUID(),
    },
    mockMail,
  );
  if (family.status !== 'success') throw Error(family.status);
  const [membership] = await db
    .insert(member)
    .values({
      id: randomUUID(),
      organizationId: family.data.organizationId,
      userId: guest.actorId,
      role: 'member',
      createdAt: new Date(),
    })
    .returning();
  const e = { workspaceId: family.data.id, operationKey: randomUUID() };
  const a = await accountCommand(owner.headers, e, {
    command: 'create',
    name: 'Общий резерв',
    type: 'reserve',
    currency: 'RUB',
    openingBalance: '220000',
  });
  if (a.status !== 'success') throw Error(a.status);
  const g = await goalCommand(
    owner.headers,
    { ...e, operationKey: randomUUID() },
    { ...owner.input, accountId: a.data.id },
  );
  if (g.status !== 'success') throw Error(g.status);
  const input = {
    command: 'configureSavings',
    goalId: g.data.id,
    monthlyContribution: '30000',
    anchorDate: todayInTimezone('Europe/Moscow'),
  };
  const edit = { ...e, operationKey: randomUUID(), expectedVersion: undefined };
  const results = await Promise.all([
    configureSavings(guest.headers, edit, input),
    configureSavings(
      owner.headers,
      { ...edit, operationKey: randomUUID() },
      { ...input, monthlyContribution: '40000' },
    ),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  const retry =
    results[0]!.status === 'success'
      ? edit
      : { ...edit, operationKey: randomUUID(), expectedVersion: '1' };
  if (results[0]!.status !== 'success')
    expect((await configureSavings(guest.headers, retry, input)).status).toBe(
      'success',
    );
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...e,
          operationKey: randomUUID(),
          expectedVersion: family.data.version,
        },
        { command: 'remove', memberId: membership!.id },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect((await configureSavings(guest.headers, retry, input)).status).toBe(
    'forbidden',
  );
  expect(
    (
      await familyCommand(
        owner.headers,
        {
          ...e,
          operationKey: randomUUID(),
          expectedVersion: family.data.version,
        },
        { command: 'delete', explicitConfirmation: true },
        mockMail,
      )
    ).status,
  ).toBe('success');
  expect(
    (
      await configureSavings(
        owner.headers,
        { ...edit, operationKey: randomUUID(), expectedVersion: '1' },
        input,
      )
    ).status,
  ).toBe('forbidden');
});
test('server КУ-010: dated goals, live balances, archived goals and scoped FK', async () => {
  const f = await fixture(),
    other = await fixture();
  const today = todayInTimezone('Europe/Moscow');
  const g = await goalCommand(f.headers, f.envelope, {
    command: 'create',
    type: 'ordinary',
    name: 'К сроку',
    currency: 'RUB',
    accountId: f.account.id,
    ordinaryTarget: '580000',
    targetDate: occurrenceDate(today, 11, 'month'),
  });
  if (g.status !== 'success') throw Error(g.status);
  expect(
    await readSavingsPlan(f.headers, f.envelope.workspaceId, g.data.id),
  ).toMatchObject({
    configured: false,
    projection: { count: '12', recommendation: '30000.00' },
  });
  const input = {
    command: 'configureSavings',
    goalId: g.data.id,
    anchorDate: today,
    monthlyContribution: '30000',
  };
  const envelope = { ...f.envelope, operationKey: randomUUID() };
  expect(await configureSavings(f.headers, envelope, input)).toMatchObject({
    status: 'success',
    data: {
      projection: {
        forecastDate: occurrenceDate(today, 11, 'month'),
        late: false,
      },
    },
  });
  expect(
    (
      await previewSavings(f.headers, f.envelope.workspaceId, {
        ...input,
        anchorDate: occurrenceDate(today, 12, 'month'),
      })
    ).state,
  ).toBe('no_dates');
  expect(
    (await readSavingsPlan(f.headers, f.envelope.workspaceId, g.data.id))
      .anchorDate,
  ).toBe(today);
  await expect(
    previewSavings(other.headers, f.envelope.workspaceId, input),
  ).rejects.toThrow('FORBIDDEN');
  await expect(
    previewSavings(f.headers, f.envelope.workspaceId, {
      ...input,
      monthlyContribution: '1.001',
    }),
  ).rejects.toThrow();
  const correction = await accountCommand(
    f.headers,
    {
      ...envelope,
      operationKey: randomUUID(),
      expectedVersion: f.account.version,
    },
    {
      command: 'correctOpening',
      accountId: f.account.id,
      openingBalance: '600000',
      explicitConfirmation: true,
    },
  );
  expect(correction.status).toBe('success');
  expect(
    (await readSavingsPlan(f.headers, f.envelope.workspaceId, g.data.id))
      .projection,
  ).toMatchObject({ state: 'reached', recommendation: '0.00' });
  // An independent goal edit also refreshes the recommendation from current terms.
  await goalCommand(
    f.headers,
    {
      ...envelope,
      operationKey: randomUUID(),
      expectedVersion: g.data.version,
    },
    {
      command: 'update',
      id: g.data.id,
      type: 'ordinary',
      name: 'К сроку',
      currency: 'RUB',
      accountId: f.account.id,
      ordinaryTarget: '100000',
      targetDate: today,
    },
  );
  expect(
    (await readSavingsPlan(f.headers, f.envelope.workspaceId, g.data.id))
      .projection,
  ).toMatchObject({ state: 'reached', recommendation: '0.00' });
  expect(
    (
      await configureSavings(
        f.headers,
        { ...envelope, operationKey: randomUUID() },
        { ...input, goalId: other.account.id },
      )
    ).status,
  ).toBe('forbidden');
  await expect(
    db.execute(
      sql`INSERT INTO savings_plan(workspace_id,goal_id,anchor_date,anchor_day) VALUES (${other.envelope.workspaceId},${g.data.id},${today},${Number(today.slice(8))})`,
    ),
  ).rejects.toThrow();
  const yen = await accountCommand(
    f.headers,
    { ...envelope, operationKey: randomUUID() },
    {
      command: 'create',
      name: 'JPY',
      type: 'accumulation',
      currency: 'JPY',
      openingBalance: '0',
    },
  );
  if (yen.status !== 'success') throw Error(yen.status);
  expect(
    (
      await goalCommand(
        f.headers,
        { ...envelope, operationKey: randomUUID(), expectedVersion: '2' },
        {
          command: 'update',
          id: g.data.id,
          type: 'ordinary',
          name: 'К сроку',
          currency: 'JPY',
          accountId: yen.data.id,
          ordinaryTarget: '100000',
          targetDate: today,
        },
      )
    ).status,
  ).toBe('conflict');
  await goalCommand(
    f.headers,
    { ...envelope, operationKey: randomUUID(), expectedVersion: '2' },
    { command: 'archive', id: g.data.id, explicitConfirmation: true },
  );
  expect(
    (
      await configureSavings(
        f.headers,
        { ...envelope, operationKey: randomUUID(), expectedVersion: '1' },
        input,
      )
    ).status,
  ).toBe('forbidden');
});
test('stored day 31 survives time passing and contribution-only edits; DB constraints', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-31T10:00:00Z'));
  try {
    const f = await fixture();
    const created = await goalCommand(f.headers, f.envelope, {
      command: 'create',
      type: 'ordinary',
      name: 'Календарь',
      currency: 'RUB',
      accountId: f.account.id,
      ordinaryTarget: '220100',
      targetDate: '2027-03-31',
    });
    if (created.status !== 'success') throw Error(created.status);
    const input = {
      command: 'configureSavings',
      goalId: created.data.id,
      anchorDate: '2027-01-31',
      monthlyContribution: '50',
    };
    const envelope = { ...f.envelope, operationKey: randomUUID() };
    expect((await configureSavings(f.headers, envelope, input)).status).toBe(
      'success',
    );
    vi.setSystemTime(new Date('2027-02-01T10:00:00Z'));
    expect(
      await readSavingsPlan(f.headers, f.envelope.workspaceId, created.data.id),
    ).toMatchObject({
      anchorDay: '31',
      projection: {
        count: '2',
        recommendation: '50.00',
        nextDate: '2027-02-28',
        forecastDate: '2027-03-31',
      },
    });
    expect(
      await configureSavings(
        f.headers,
        { ...envelope, operationKey: randomUUID(), expectedVersion: '1' },
        { ...input, monthlyContribution: '100' },
      ),
    ).toMatchObject({
      status: 'success',
      data: { anchorDay: '31', projection: { forecastDate: '2027-02-28' } },
    });
    for (const clause of [
      'anchor_day=28',
      "monthly_contribution='NaN'::numeric",
      "monthly_contribution='Infinity'::numeric",
      'monthly_contribution=-1',
      'version=0',
    ])
      await expect(
        db.execute(
          sql.raw(
            `UPDATE savings_plan SET ${clause} WHERE goal_id='${created.data.id}'`,
          ),
        ),
      ).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
