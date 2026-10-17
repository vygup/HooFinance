import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import {
  integrationDb as db,
  registeredActor,
  authRequest,
} from './auth-fixture';
import { organizationTransaction } from '@/server/auth/organization-adapter';
import { requireWorkspace } from '@/server/security/access';
import { user, organization, member } from '@/server/db/schema/identity';
import { workspace } from '@/server/db/schema/workspaces';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import {
  financialAction,
  actionRevision,
  ledgerLeg,
} from '@/server/db/schema/ledger';

async function fixture() {
  const actorId = randomUUID();
  await db.insert(user).values({
    id: actorId,
    name: 'Тест',
    email: `${actorId}@example.org`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [personal] = await db
    .insert(workspace)
    .values({ kind: 'personal', personalOwnerId: actorId, name: 'Личное' })
    .returning();
  if (!personal) throw new Error('FIXTURE_FAILED');
  const [account] = await db
    .insert(financialAccount)
    .values({
      workspaceId: personal.id,
      name: 'Счёт',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '9007199254740993.01',
      balanceProjection: '9007199254740993.01',
    })
    .returning();
  if (!account) throw new Error('FIXTURE_FAILED');
  return { actorId, personal, account };
}
test('NUMERIC возвращается строкой и личное пространство доступно только владельцу', async () => {
  const f = await fixture();
  expect(f.account.openingBalance).toBe('9007199254740993.01');
  expect(
    (await requireWorkspace(f.actorId, f.personal.id, 'read', db)).id,
  ).toBe(f.personal.id);
  await expect(
    requireWorkspace(randomUUID(), f.personal.id, 'read', db),
  ).rejects.toThrow('FORBIDDEN');
});
test('Составной FK отклоняет категорию другого пространства и откатывает всё действие', async () => {
  const f = await fixture(),
    other = await fixture();
  const [cat] = await db
    .insert(category)
    .values({ workspaceId: other.personal.id, name: 'Расход', kind: 'expense' })
    .returning();
  if (!cat) throw new Error('FIXTURE_FAILED');
  const actionId = randomUUID();
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(financialAction).values({
        id: actionId,
        creatorId: f.actorId,
        kind: 'expense',
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
        workspaceId: f.personal.id,
        actionId,
        revisionNo: 1,
        accountId: f.account.id,
        currency: 'RUB',
        role: 'expense',
        amount: '1.00',
        financialDate: '2026-10-17',
        categoryId: cat.id,
      });
    }),
  ).rejects.toThrow();
  expect(
    await db
      .select()
      .from(financialAction)
      .where(eq(financialAction.id, actionId)),
  ).toHaveLength(0);
});
test('Deferred owner trigger принимает целую семью и отклоняет commit без владельца', async () => {
  const f = await fixture();
  const orgId = randomUUID();
  let familyId = '';
  await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({ id: orgId, name: 'Семья', slug: orgId, createdAt: new Date() });
    const [family] = await tx
      .insert(workspace)
      .values({
        kind: 'family',
        name: 'Семья',
        organizationId: orgId,
        familyOwnerId: f.actorId,
        timezone: 'Europe/Moscow',
      })
      .returning();
    if (!family) throw new Error('FIXTURE_FAILED');
    familyId = family.id;
    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: f.actorId,
      role: 'owner',
      createdAt: new Date(),
    });
  });
  expect((await requireWorkspace(f.actorId, familyId, 'owner', db)).id).toBe(
    familyId,
  );
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(member)
        .set({ role: 'member' })
        .where(eq(member.organizationId, orgId));
    }),
  ).rejects.toThrow();
  expect(
    (await db.select().from(member).where(eq(member.organizationId, orgId)))[0]
      ?.role,
  ).toBe('owner');
});
test('Прямые Organization endpoints не обходят доменную авторизацию', async () => {
  for (const [path, body] of [
    ['/organization/create', { name: 'Чужая', slug: randomUUID() }],
    [
      '/organization/update-member-role',
      { organizationId: randomUUID(), memberId: randomUUID(), role: 'owner' },
    ],
    ['/organization/delete', { organizationId: randomUUID() }],
  ] as const) {
    expect((await authRequest(path, body)).status).toBe(403);
  }
});
test('Нативные Organization writes выполняются на переданном tx и полностью откатываются', async () => {
  const actor = await registeredActor();
  const slug = randomUUID();
  await expect(
    organizationTransaction(
      actor.headers,
      null,
      ['/organization/create'],
      async ({ auth }) => {
        await auth.api.createOrganization({
          headers: actor.headers,
          body: { name: 'Откат', slug },
        });
        throw new Error('INJECTED_FAILURE');
      },
    ),
  ).rejects.toThrow('INJECTED_FAILURE');
  expect(
    await db.select().from(organization).where(eq(organization.slug, slug)),
  ).toHaveLength(0);
  const stored = await testPool.query(
    'SELECT token FROM session WHERE user_id=$1',
    [actor.actorId],
  );
  expect(stored.rows[0].token).toMatch(/^v1\./);
});

test('Deferred ledger trigger запрещает половину перевода; revisions и audit неизменяемы', async () => {
  const { transferDetail, scopedAuditEvent } =
    await import('@/server/db/schema/ledger');
  const f = await fixture();
  const [destination] = await db
    .insert(financialAccount)
    .values({
      workspaceId: f.personal.id,
      name: 'Второй',
      type: 'cash',
      currency: 'RUB',
      openingBalance: '0',
      balanceProjection: '0',
    })
    .returning();
  if (!destination) throw new Error('FIXTURE_FAILED');
  const incomplete = randomUUID();
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(financialAction).values({
        id: incomplete,
        creatorId: f.actorId,
        kind: 'transfer',
        status: 'active',
        currentRevision: 1,
      });
      await tx.insert(actionRevision).values({
        actionId: incomplete,
        revisionNo: 1,
        actorId: f.actorId,
        status: 'active',
      });
      await tx.insert(ledgerLeg).values({
        workspaceId: f.personal.id,
        actionId: incomplete,
        revisionNo: 1,
        accountId: f.account.id,
        currency: 'RUB',
        role: 'transfer_out',
        amount: '1.00',
        financialDate: '2026-10-17',
      });
    }),
  ).rejects.toThrow();
  expect(
    await db
      .select()
      .from(financialAction)
      .where(eq(financialAction.id, incomplete)),
  ).toHaveLength(0);
  const actionId = randomUUID();
  let sourceId = '';
  await db.transaction(async (tx) => {
    await tx.insert(financialAction).values({
      id: actionId,
      creatorId: f.actorId,
      kind: 'transfer',
      status: 'active',
      currentRevision: 1,
    });
    await tx.insert(actionRevision).values({
      actionId,
      revisionNo: 1,
      actorId: f.actorId,
      status: 'active',
    });
    const legs = await tx
      .insert(ledgerLeg)
      .values([
        {
          workspaceId: f.personal.id,
          actionId,
          revisionNo: 1,
          accountId: f.account.id,
          currency: 'RUB',
          role: 'transfer_out',
          amount: '1.00',
          financialDate: '2026-10-17',
        },
        {
          workspaceId: f.personal.id,
          actionId,
          revisionNo: 1,
          accountId: destination.id,
          currency: 'RUB',
          role: 'transfer_in',
          amount: '1.00',
          financialDate: '2026-10-17',
        },
      ])
      .returning();
    const source = legs.find((l) => l.role === 'transfer_out'),
      target = legs.find((l) => l.role === 'transfer_in');
    if (!source || !target) throw new Error('FIXTURE_FAILED');
    sourceId = source.id;
    await tx.insert(transferDetail).values({
      actionId,
      revisionNo: 1,
      sourceLegId: source.id,
      destinationLegId: target.id,
      rateNumerator: '1.00',
      rateDenominator: '1.00',
      rateDecimal: '1',
      rateDirection: 'source_per_destination',
    });
  });
  await expect(
    db.update(ledgerLeg).set({ amount: '2' }).where(eq(ledgerLeg.id, sourceId)),
  ).rejects.toThrow();
  await expect(
    db
      .update(actionRevision)
      .set({ reason: 'rewrite' })
      .where(eq(actionRevision.actionId, actionId)),
  ).rejects.toThrow();
  const [audit] = await db
    .insert(scopedAuditEvent)
    .values({
      workspaceId: f.personal.id,
      objectType: 'test',
      objectId: actionId,
      actorId: f.actorId,
      revisionNo: 1,
      kind: 'test',
    })
    .returning();
  if (!audit) throw new Error('FIXTURE_FAILED');
  await expect(
    db.delete(scopedAuditEvent).where(eq(scopedAuditEvent.id, audit.id)),
  ).rejects.toThrow();
});

test('Provisioning callback получает тот же tx; его сбой откатывает auth user и domain fixture', async () => {
  const { createAuth } = await import('@/server/auth/auth');
  const { createMockMailTransport } = await import('@/server/mail/transport');
  const { getConfig } = await import('@/server/config');
  const email = `provision-${randomUUID()}@example.org`;
  let provisioningObserved = false;
  const auth = createAuth(
    db,
    createMockMailTransport(),
    false,
    async (created, tx) => {
      await tx.insert(workspace).values({
        kind: 'personal',
        personalOwnerId: created.id,
        name: 'Fixture provisioning',
      });
      provisioningObserved = true;
      throw new Error('INJECTED_PROVISION_FAILURE');
    },
  );
  const c = getConfig();
  const response = await auth.handler(
    new Request(`${c.APP_ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: c.APP_ORIGIN },
      body: JSON.stringify({
        email,
        name: 'Тест',
        password: 'TestStrongPassword123!',
      }),
    }),
  );
  expect(response.status).not.toBe(200);
  expect(provisioningObserved).toBe(true);
  expect(
    await db.select().from(user).where(eq(user.email, email)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(workspace)
      .where(eq(workspace.name, 'Fixture provisioning')),
  ).toHaveLength(0);
});
