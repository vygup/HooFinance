import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import { integrationDb as db, registeredActor, mockMail } from './auth-fixture';
import {
  createFamily,
  familyCommand,
  readFamilies,
  readFamily,
  respondFamilyInvitation,
} from '@/modules/workspaces/application/family';
import { exportHistory } from '@/modules/data-exchange/application/export-history';
import { invitation } from '@/server/db/schema/identity';
import { encryptToken } from '@/server/security/encryption';
function data<T>(r: { status: string; data?: T }): T {
  expect(r.status).toBe('success');
  return r.data!;
}
async function fixture() {
  const owner = await registeredActor(),
    guest = await registeredActor();
  const created = data(
    await createFamily(
      owner.headers,
      { name: 'Семья', timezone: 'Europe/Moscow', operationKey: randomUUID() },
      mockMail,
    ),
  );
  const envelope = (version = created.version) => ({
    workspaceId: created.id,
    operationKey: randomUUID(),
    expectedVersion: version,
  });
  const run = (payload: unknown, version?: string) =>
    familyCommand(owner.headers, envelope(version), payload, mockMail);
  const invite = async () => {
    data(await run({ command: 'invite', email: guest.email }));
    const rows = await db
      .select()
      .from(invitation)
      .where(eq(invitation.organizationId, created.organizationId));
    return rows.at(-1)!;
  };
  const accept = async () => {
    const i = await invite();
    data(
      await respondFamilyInvitation(guest.headers, {
        secret: encryptToken(i.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      }),
    );
  };
  return { owner, guest, created, envelope, run, invite, accept };
}
test('createFamily is atomic/idempotent, preserves personal, active picker isolates two families', async () => {
  const f = await fixture();
  const input = {
    name: 'Другая',
    timezone: 'Asia/Tokyo',
    operationKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    createFamily(f.owner.headers, input, mockMail),
    createFamily(f.owner.headers, input, mockMail),
  ]);
  expect(a).toEqual(b);
  data(a);
  expect((await readFamilies(f.owner.headers)).active).toHaveLength(3);
  expect((await readFamilies(f.guest.headers)).active).toHaveLength(1);
  expect(
    (await createFamily(f.owner.headers, { ...input, name: 'Иная' }, mockMail))
      .status,
  ).toBe('conflict');
  await expect(readFamily(f.guest.headers, f.created.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  await testPool.query(
    `CREATE FUNCTION us02_fail_create() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Rollback family' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`,
  );
  await testPool.query(
    'CREATE TRIGGER us02_fail_create BEFORE INSERT ON workspace FOR EACH ROW EXECUTE FUNCTION us02_fail_create()',
  );
  try {
    expect(
      (
        await createFamily(
          f.owner.headers,
          { ...input, name: 'Rollback family', operationKey: randomUUID() },
          mockMail,
        )
      ).status,
    ).toBe('unavailable');
    expect(
      (
        await testPool.query(
          "SELECT id FROM organization WHERE name='Rollback family'",
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await testPool.query('DROP TRIGGER us02_fail_create ON workspace');
    await testPool.query('DROP FUNCTION us02_fail_create()');
  }
});
test('invite recipient, reject/cancel/expiry and no automatic membership; native plugin roles', async () => {
  const f = await fixture();
  let i = await f.invite();
  const respond = (headers: Headers, decision = 'accept') =>
    respondFamilyInvitation(headers, {
      secret: encryptToken(i.id, 'invitation-link'),
      decision,
      operationKey: randomUUID(),
    });
  expect((await respond(f.owner.headers)).status).toBe('forbidden');
  data(await respond(f.guest.headers, 'reject'));
  expect((await respond(f.guest.headers)).status).toBe('forbidden');
  // Rate limits are independently covered; fixtures advance the persisted window.
  await testPool.query(
    "UPDATE auth_rate_bucket SET attempt_timestamps='[]'::jsonb",
  );
  i = await f.invite();
  data(await f.run({ command: 'cancelInvite', invitationId: i.id }));
  expect((await respond(f.guest.headers)).status).toBe('forbidden');
  await testPool.query(
    "UPDATE auth_rate_bucket SET attempt_timestamps='[]'::jsonb",
  );
  i = await f.invite();
  await db
    .update(invitation)
    .set({ expiresAt: new Date(0) })
    .where(eq(invitation.id, i.id));
  expect((await respond(f.guest.headers)).status).toBe('forbidden');
  await testPool.query(
    "UPDATE auth_rate_bucket SET attempt_timestamps='[]'::jsonb",
  );
  await f.accept();
  expect((await readFamily(f.guest.headers, f.created.id)).role).toBe('member');
  for (const payload of [
    { command: 'rename', name: 'Нет' },
    { command: 'invite', email: 'other@example.org' },
    { command: 'delete', explicitConfirmation: true },
  ])
    expect(
      (await familyCommand(f.guest.headers, f.envelope(), payload, mockMail))
        .status,
    ).toBe('forbidden');
  expect((await f.run({ command: 'leave' })).status).toBe('forbidden');
  const detail = await readFamily(f.owner.headers, f.created.id);
  const guest = detail.members.find((m) => m.userId === f.guest.actorId)!;
  data(await f.run({ command: 'remove', memberId: guest.id }));
  await expect(readFamily(f.guest.headers, f.created.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (await familyCommand(f.guest.headers, f.envelope(), { command: 'leave' }))
      .status,
  ).toBe('forbidden');
});
test('rename/timezone version atomically increment, stale owner offer cannot accept, transfer rollback then confirmation', async () => {
  const f = await fixture();
  await f.accept();
  const offered = data(
    await f.run({ command: 'offer', recipientId: f.guest.actorId }),
  );
  data(await f.run({ command: 'rename', name: 'Новое' }));
  expect(
    (await f.run({ command: 'timezone', timezone: 'Asia/Tokyo' })).status,
  ).toBe('conflict');
  expect(
    (
      await familyCommand(f.guest.headers, f.envelope('2'), {
        command: 'acceptOwnership',
        offerId: offered.offerId,
      })
    ).status,
  ).toBe('conflict');
  const renamed = await readFamily(f.owner.headers, f.created.id);
  expect(renamed.version).toBe('2');
  data(await f.run({ command: 'timezone', timezone: 'Asia/Tokyo' }, '2'));
  const next = data(
    await f.run({ command: 'offer', recipientId: f.guest.actorId }, '3'),
  );
  await testPool.query(
    `CREATE FUNCTION us02_fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.family_owner_id<>OLD.family_owner_id THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`,
  );
  await testPool.query(
    'CREATE TRIGGER us02_fail_transfer BEFORE UPDATE ON workspace FOR EACH ROW EXECUTE FUNCTION us02_fail_transfer()',
  );
  const accept = () =>
    familyCommand(f.guest.headers, f.envelope('3'), {
      command: 'acceptOwnership',
      offerId: next.offerId,
    });
  try {
    expect((await accept()).status).toBe('unavailable');
    expect((await readFamily(f.owner.headers, f.created.id)).role).toBe(
      'owner',
    );
  } finally {
    await testPool.query('DROP TRIGGER us02_fail_transfer ON workspace');
    await testPool.query('DROP FUNCTION us02_fail_transfer()');
  }
  const results = await Promise.all([accept(), accept()]);
  expect(results.filter((r) => r.status === 'success')).toHaveLength(1);
  const changed = await readFamily(f.guest.headers, f.created.id);
  expect(changed.version).toBe('4');
  expect(changed.members.filter((m) => m.role === 'owner')).toHaveLength(1);
  data(await f.run({ command: 'leave' }, '4'));
  await expect(readFamily(f.owner.headers, f.created.id)).rejects.toThrow();
});
test('accept/delete serialized, sole owner deletion cancels invites and retains owner-only history/export', async () => {
  const f = await fixture();
  const i = await f.invite();
  const [accept, del] = await Promise.all([
    respondFamilyInvitation(f.guest.headers, {
      secret: encryptToken(i.id, 'invitation-link'),
      decision: 'accept',
      operationKey: randomUUID(),
    }),
    f.run({ command: 'delete', explicitConfirmation: true }),
  ]);
  expect(
    [accept.status, del.status].filter((s) => s === 'success'),
  ).toHaveLength(1);
  if (accept.status === 'success') {
    expect(del.status).toBe('forbidden');
    data(
      await familyCommand(f.guest.headers, f.envelope(), { command: 'leave' }),
    );
    data(await f.run({ command: 'delete', explicitConfirmation: true }));
  }
  expect(
    (await readFamilies(f.owner.headers)).deleted.map((s) => s.id),
  ).toContain(f.created.id);
  expect(
    (await readFamilies(f.owner.headers)).active.map((s) => s.id),
  ).not.toContain(f.created.id);
  expect((await readFamily(f.owner.headers, f.created.id, true)).version).toBe(
    '2',
  );
  expect((await f.run({ command: 'rename', name: 'Нет' }, '2')).status).toBe(
    'forbidden',
  );
  expect(await exportHistory(f.owner.headers, f.created.id)).toContain(
    'format_version',
  );
  await expect(exportHistory(f.guest.headers, f.created.id)).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(
    (
      await respondFamilyInvitation(f.guest.headers, {
        secret: encryptToken(i.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('forbidden');
});

test('Deleted-family FX history omits personal counterparty/rate, retains exact amounts and personal financial effect', async () => {
  const f = await fixture();
  const { financialAccount } = await import('@/server/db/schema/accounts');
  const { workspace } = await import('@/server/db/schema/workspaces');
  const { financialAction, actionRevision, ledgerLeg, transferDetail } =
    await import('@/server/db/schema/ledger');
  const { historyRows } =
    await import('@/modules/data-exchange/application/export-history');
  const { GET } =
    await import('@/app/api/workspaces/[workspaceId]/csv/export/route');
  const [personal] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, f.owner.actorId));
  const [source] = await db
    .insert(financialAccount)
    .values({
      workspaceId: personal!.id,
      name: 'PRIVATE ACCOUNT',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '20000.00',
      balanceProjection: '10000.00',
    })
    .returning();
  const [destination] = await db
    .insert(financialAccount)
    .values({
      workspaceId: f.created.id,
      name: ' \t=Семейный "счёт"',
      type: 'cash',
      currency: 'USD',
      openingBalance: '0.00',
      balanceProjection: '100.00',
    })
    .returning();
  const actionId = randomUUID(),
    sourceLegId = randomUUID(),
    destinationLegId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(financialAction).values({
      id: actionId,
      creatorId: f.owner.actorId,
      kind: 'transfer',
      status: 'active',
      currentRevision: 1,
    });
    await tx.insert(actionRevision).values({
      actionId,
      revisionNo: 1,
      actorId: f.owner.actorId,
      status: 'active',
    });
    await tx.insert(ledgerLeg).values([
      {
        id: sourceLegId,
        workspaceId: personal!.id,
        actionId,
        revisionNo: 1,
        accountId: source!.id,
        role: 'transfer_out',
        amount: '10000.00',
        currency: 'RUB',
        financialDate: '2026-10-17',
        privateDescription: 'PRIVATE DESCRIPTION',
      },
      {
        id: destinationLegId,
        workspaceId: f.created.id,
        actionId,
        revisionNo: 1,
        accountId: destination!.id,
        role: 'transfer_in',
        amount: '100.00',
        currency: 'USD',
        financialDate: '2026-10-17',
        privateDescription: 'Семейная\nстрока',
      },
    ]);
    await tx.insert(transferDetail).values({
      actionId,
      revisionNo: 1,
      sourceLegId,
      destinationLegId,
      rateNumerator: '10000.00',
      rateDenominator: '100.00',
      rateDecimal: '100',
      rateDirection: 'RUB/USD',
    });
  });
  const before = await db
    .select()
    .from(financialAccount)
    .where(eq(financialAccount.id, source!.id));
  data(await f.run({ command: 'delete', explicitConfirmation: true }));
  const rows = await historyRows(f.owner.headers, f.created.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: destinationLegId,
    amount: '100.00',
    counterpartyAccount: '',
    counterpartyCurrency: '',
    counterpartyAmount: '',
    rateNumerator: '',
    rateDenominator: '',
  });
  const csv = await exportHistory(f.owner.headers, f.created.id);
  for (const hidden of ['PRIVATE', source!.id, sourceLegId, '10000.00'])
    expect(csv).not.toContain(hidden);
  expect(csv).toContain('"\' \t=Семейный ""счёт"""');
  expect(csv).toContain('Семейная\nстрока');
  expect(
    await db
      .select()
      .from(financialAccount)
      .where(eq(financialAccount.id, source!.id)),
  ).toEqual(before);
  expect(
    (await db.select().from(ledgerLeg).where(eq(ledgerLeg.id, sourceLegId)))[0]!
      .amount,
  ).toBe('10000.00');
  const response = await GET(
    new Request(`http://localhost/api/workspaces/${f.created.id}/csv/export`, {
      headers: f.owner.headers,
    }),
    { params: Promise.resolve({ workspaceId: f.created.id }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-disposition')).toContain(
    'family-history.csv',
  );
  expect(
    (
      await GET(
        new Request('http://localhost/', { headers: f.guest.headers }),
        { params: Promise.resolve({ workspaceId: f.created.id }) },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await GET(new Request('http://localhost/'), {
        params: Promise.resolve({ workspaceId: f.created.id }),
      })
    ).status,
  ).toBe(401);
});
test('Resend invalidates old secret; a retry after removal is denied; offer acceptance races with removal/delete', async () => {
  const f = await fixture();
  const first = await f.invite();
  await testPool.query(
    "UPDATE auth_rate_bucket SET attempt_timestamps='[]'::jsonb",
  );
  const second = await f.invite();
  expect(second.id).not.toBe(first.id);
  expect(
    (
      await respondFamilyInvitation(f.guest.headers, {
        secret: encryptToken(first.id, 'invitation-link'),
        decision: 'accept',
        operationKey: randomUUID(),
      })
    ).status,
  ).toBe('forbidden');
  const response = {
    secret: encryptToken(second.id, 'invitation-link'),
    decision: 'accept',
    operationKey: randomUUID(),
  };
  data(await respondFamilyInvitation(f.guest.headers, response));
  data(await respondFamilyInvitation(f.guest.headers, response));
  const offer = data(
    await f.run({ command: 'offer', recipientId: f.guest.actorId }),
  );
  expect(
    (await f.run({ command: 'delete', explicitConfirmation: true })).status,
  ).toBe('forbidden');
  const detail = await readFamily(f.owner.headers, f.created.id),
    guest = detail.members.find((m) => m.userId === f.guest.actorId)!;
  const [accept, remove] = await Promise.all([
    familyCommand(f.guest.headers, f.envelope(), {
      command: 'acceptOwnership',
      offerId: offer.offerId,
    }),
    f.run({ command: 'remove', memberId: guest.id }),
  ]);
  expect(
    [accept.status, remove.status].filter((s) => s === 'success'),
  ).toHaveLength(1);
  if (remove.status === 'success') {
    expect(
      (await respondFamilyInvitation(f.guest.headers, response)).status,
    ).toBe('forbidden');
    expect(
      (
        await familyCommand(f.guest.headers, f.envelope(), {
          command: 'acceptOwnership',
          offerId: offer.offerId,
        })
      ).status,
    ).toBe('forbidden');
  } else {
    expect(
      (await f.run({ command: 'delete', explicitConfirmation: true }, '2'))
        .status,
    ).toBe('forbidden');
  }
});
