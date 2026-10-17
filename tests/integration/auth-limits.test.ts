import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import {
  reserveRateLimits,
  releaseRateLimit,
  RateLimitError,
  invitationPolicies,
} from '@/server/auth/rate-limits';
import {
  integrationDb as db,
  authRequest,
  registeredActor,
  mockMail,
} from './auth-fixture';
import { getConfig } from '@/server/config';
import { authRateBucket } from '@/server/db/schema/auth-rate-limits';
beforeEach(async () => {
  await db.delete(authRateBucket);
});

test('Атомарный sliding window отклоняет конкурентный обход и открывается ровно на границе', async () => {
  const now = new Date('2026-10-17T00:00:00Z');
  const policy = {
    action: 'test-window',
    subject: randomUUID(),
    limit: 3,
    windowSeconds: 60,
  };
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => reserveRateLimits([policy], db, now)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  expect(
    results
      .filter((r) => r.status === 'rejected')
      .every(
        (r) => r.status === 'rejected' && r.reason instanceof RateLimitError,
      ),
  ).toBe(true);
  await expect(
    reserveRateLimits([policy], db, new Date(now.getTime() + 59999)),
  ).rejects.toThrow('RATE_LIMITED');
  await expect(
    reserveRateLimits([policy], db, new Date(now.getTime() + 60000)),
  ).resolves.toBeDefined();
});
test('Успешная попытка освобождает reservation; повтор приглашения ограничен', async () => {
  const policy = {
    action: 'test-release',
    subject: randomUUID(),
    limit: 1,
    windowSeconds: 60,
  };
  const reservation = await reserveRateLimits([policy], db);
  await releaseRateLimit(reservation, db);
  await expect(reserveRateLimits([policy], db)).resolves.toBeDefined();
  const policies = invitationPolicies(
    randomUUID(),
    `${randomUUID()}@example.org`,
  );
  await reserveRateLimits(policies, db);
  await expect(reserveRateLimits(policies, db)).rejects.toThrow('RATE_LIMITED');
});
test('Прямой login endpoint ограничивает неудачи; forwarded IP не позволяет обход', async () => {
  const email = `unknown-${randomUUID()}@example.org`;
  for (let i = 0; i < getConfig().AUTH_LOGIN_LIMIT; i++)
    expect(
      (
        await authRequest('/sign-in/email', {
          email,
          password: 'WrongPassword123!',
        })
      ).status,
    ).toBe(401);
  expect(
    (
      await authRequest(
        '/sign-in/email',
        { email, password: 'WrongPassword123!' },
        new Headers({ 'x-forwarded-for': '9.8.7.6' }),
      )
    ).status,
  ).toBe(429);
});
test('Reset не раскрывает регистрацию, одноразовый токен отзывается после использования', async () => {
  const actor = await registeredActor();
  mockMail.clear();
  const known = await authRequest('/request-password-reset', {
    email: actor.email,
  });
  const unknown = await authRequest('/request-password-reset', {
    email: `missing-${randomUUID()}@example.org`,
  });
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  expect(mockMail.messages).toHaveLength(1);
  const text = mockMail.messages[0]?.text ?? '';
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error('RESET_LINK_MISSING');
  const token =
    new URL(url).searchParams.get('token') ??
    url.split('/reset-password/')[1]?.split('?')[0];
  if (!token) throw new Error('RESET_TOKEN_MISSING');
  expect(
    (
      await authRequest('/reset-password', {
        token,
        newPassword: 'NewStrongPassword123!',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await authRequest('/reset-password', {
        token,
        newPassword: 'AnotherStrongPassword123!',
      })
    ).status,
  ).not.toBe(200);
});

test('Приглашения: TTL 7 суток, resend отзывает прежний secret, принятие конкурентно одноразовое', async () => {
  const { organizationTransaction, respondToInvitation } =
    await import('@/server/auth/organization-adapter');
  const { workspace } = await import('@/server/db/schema/workspaces');
  const { invitation, member } = await import('@/server/db/schema/identity');
  const { eq, and } = await import('drizzle-orm');
  const owner = await registeredActor(),
    recipient = await registeredActor();
  const family = await organizationTransaction(
    owner.headers,
    null,
    ['/organization/create'],
    async ({ tx, auth, actorId }) => {
      const org = await auth.api.createOrganization({
        headers: owner.headers,
        body: { name: 'Семья', slug: randomUUID() },
      });
      if (!org) throw new Error('ORG_CREATE_FAILED');
      const [scope] = await tx
        .insert(workspace)
        .values({
          kind: 'family',
          name: 'Семья',
          organizationId: org.id,
          familyOwnerId: actorId,
          timezone: 'Europe/Moscow',
        })
        .returning();
      if (!scope) throw new Error('FIXTURE_FAILED');
      return scope;
    },
    mockMail,
  );
  const invite = () =>
    organizationTransaction(
      owner.headers,
      family.id,
      ['/organization/invite-member'],
      async ({ auth }) =>
        auth.api.createInvitation({
          headers: owner.headers,
          body: {
            organizationId: family.organizationId!,
            email: recipient.email,
            role: 'member',
            resend: true,
          },
        }),
      mockMail,
    );
  function latestToken() {
    const text = mockMail.messages.at(-1)?.text ?? '';
    const link = text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('INVITATION_LINK_MISSING');
    const token = new URL(link).searchParams.get('token');
    if (!token) throw new Error('INVITATION_TOKEN_MISSING');
    return token;
  }
  mockMail.clear();
  const first = await invite();
  const oldToken = latestToken();
  expect(first.expiresAt.getTime() - Date.now()).toBeGreaterThan(604790000);
  await expect(invite()).rejects.toThrow(); // Не чаще одного раза в минуту.
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(now + 61000);
    const second = await invite();
    const token = latestToken();
    expect(second.id).not.toBe(first.id);
    await expect(
      respondToInvitation(recipient.headers, oldToken, 'accept'),
    ).rejects.toThrow('FORBIDDEN');
    const results = await Promise.allSettled([
      respondToInvitation(recipient.headers, token, 'accept'),
      respondToInvitation(recipient.headers, token, 'accept'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.organizationId, family.organizationId!),
            eq(member.userId, recipient.actorId),
          ),
        ),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
  const thirdRecipient = await registeredActor();
  const expired = await organizationTransaction(
    owner.headers,
    family.id,
    ['/organization/invite-member'],
    async ({ auth }) =>
      auth.api.createInvitation({
        headers: owner.headers,
        body: {
          organizationId: family.organizationId!,
          email: thirdRecipient.email,
          role: 'member',
        },
      }),
    mockMail,
  );
  const expiredToken = latestToken();
  await db
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(invitation.id, expired.id));
  await expect(
    respondToInvitation(thirdRecipient.headers, expiredToken, 'accept'),
  ).rejects.toThrow('FORBIDDEN');
  // Три отправки уже состоялись; доводим owner counter до девяти и проверяем реальный endpoint на границе.
  for (let i = 0; i < 6; i++) {
    const ownerPolicy = invitationPolicies(
      owner.actorId,
      `${randomUUID()}@example.org`,
    )[0];
    if (!ownerPolicy) throw new Error('POLICY_MISSING');
    await reserveRateLimits([ownerPolicy], db);
  }
  const inviteAnother = () =>
    organizationTransaction(
      owner.headers,
      family.id,
      ['/organization/invite-member'],
      async ({ auth }) =>
        auth.api.createInvitation({
          headers: owner.headers,
          body: {
            organizationId: family.organizationId!,
            email: `${randomUUID()}@example.org`,
            role: 'member',
          },
        }),
      mockMail,
    );
  await expect(inviteAnother()).resolves.toBeDefined();
  await expect(inviteAnother()).rejects.toThrow('RATE_LIMITED');
});

test('Успешный вход освобождает лимит, reset ограничен по адресу и IP', async () => {
  const actor = await registeredActor();
  for (let i = 0; i < 6; i++)
    expect(
      (
        await authRequest('/sign-in/email', {
          email: actor.email,
          password: actor.password,
        })
      ).status,
    ).toBe(200);
  const missing = `missing-${randomUUID()}@example.org`;
  for (let i = 0; i < 3; i++)
    expect(
      (await authRequest('/request-password-reset', { email: missing })).status,
    ).toBe(200);
  expect(
    (await authRequest('/request-password-reset', { email: missing })).status,
  ).toBe(429);
  for (let i = 0; i < 7; i++)
    expect(
      (
        await authRequest('/request-password-reset', {
          email: `missing-${randomUUID()}@example.org`,
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await authRequest('/request-password-reset', {
        email: `missing-${randomUUID()}@example.org`,
      })
    ).status,
  ).toBe(429);
});
test('Reset link истекает через час и не принимается после expiry', async () => {
  const { verification } = await import('@/server/db/schema/identity');
  const { eq } = await import('drizzle-orm');
  const actor = await registeredActor();
  mockMail.clear();
  expect(
    (await authRequest('/request-password-reset', { email: actor.email }))
      .status,
  ).toBe(200);
  const rows = await db
    .select()
    .from(verification)
    .where(eq(verification.value, actor.actorId));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error('RESET_RECORD_MISSING');
  expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(3590000);
  expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600000);
  const link = mockMail.messages.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('RESET_LINK_MISSING');
  const token =
    new URL(link).searchParams.get('token') ??
    link.split('/reset-password/')[1]?.split('?')[0];
  if (!token) throw new Error('RESET_TOKEN_MISSING');
  expect(row.identifier).not.toContain(token);
  await db
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(verification.id, row.id));
  expect(
    (
      await authRequest('/reset-password', {
        token,
        newPassword: 'NewStrongPassword123!',
      })
    ).status,
  ).not.toBe(200);
});
