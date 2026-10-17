import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { testPool } from './setup';
vi.mock('@/server/db/client', () => ({
  getDb: () => drizzle(testPool),
  getPool: () => testPool,
}));
import {
  integrationDb as db,
  registeredActor,
  authRequest,
  mockMail,
} from './auth-fixture';
import { createAuth } from '@/server/auth/auth';
import {
  user,
  userProfile,
  account,
  session,
  verification,
  organization,
  member,
} from '@/server/db/schema/identity';
import { workspace } from '@/server/db/schema/workspaces';
import { authRateBucket } from '@/server/db/schema/auth-rate-limits';
import { currentActor, requireWorkspace } from '@/server/security/access';
import {
  readProfile,
  updateProfile,
  personalDashboard,
} from '@/modules/identity/application/registration';
import { provisionPersonal } from '@/modules/identity/infrastructure/registration-repository';
beforeEach(async () => {
  await db.delete(authRateBucket);
  mockMail.clear();
});
test('Signup создаёт ровно один personal и профиль; нормализованный повтор и гонка не создают дубль', async () => {
  const a = await registeredActor();
  const scopes = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, a.actorId));
  expect(scopes).toHaveLength(1);
  expect(await personalDashboard(a.headers)).toMatchObject({
    id: scopes[0]!.id,
    kind: 'personal',
  });
  expect(await readProfile(a.headers)).toMatchObject({
    name: 'Тест',
    locale: 'ru-RU',
    timezone: 'Europe/Moscow',
    version: '1',
  });
  expect(
    (
      await authRequest('/sign-up/email', {
        email: ` ${a.email.toUpperCase()} `,
        password: a.password,
        name: 'Повтор',
      })
    ).status,
  ).not.toBe(200);
  expect(
    await db.select().from(user).where(eq(user.email, a.email)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(workspace)
      .where(eq(workspace.personalOwnerId, a.actorId)),
  ).toHaveLength(1);
  const email = `${randomUUID()}@example.org`;
  const results = await Promise.all(
    [1, 2].map(() =>
      authRequest('/sign-up/email', {
        email,
        name: 'Гонка',
        password: a.password,
      }),
    ),
  );
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  const [created] = await db.select().from(user).where(eq(user.email, email));
  expect(
    await db
      .select()
      .from(workspace)
      .where(eq(workspace.personalOwnerId, created!.id)),
  ).toHaveLength(1);
});
test('Ошибка после provisioning откатывает user, workspace, profile, account и session полностью', async () => {
  const email = `${randomUUID()}@example.org`;
  let createdId = '';
  const auth = createAuth(db, mockMail, false, async (created, tx) => {
    createdId = created.id;
    await provisionPersonal(created, tx);
    throw new Error('TEST_PROVISION_FAILURE');
  });
  await expect(
    auth.api.signUpEmail({
      body: { email, name: 'Rollback', password: 'StrongPassword123!' },
    }),
  ).rejects.toThrow();
  for (const [table, predicate] of [
    [user, eq(user.email, email)],
    [workspace, eq(workspace.personalOwnerId, createdId)],
    [userProfile, eq(userProfile.userId, createdId)],
    [account, eq(account.userId, createdId)],
    [session, eq(session.userId, createdId)],
  ] as const) {
    expect(await db.select().from(table).where(predicate)).toHaveLength(0);
  }
});
test('Профиль меняется атомарно только собственной session, stale version не меняет имя; concurrent update выигрывает один', async () => {
  const a = await registeredActor();
  const b = await registeredActor();
  const input = {
    name: 'Анна',
    locale: 'en-US',
    timezone: 'Asia/Tokyo',
    expectedVersion: '1',
  };
  expect(await updateProfile(a.headers, input)).toMatchObject({
    status: 'success',
    data: { name: 'Анна', version: '2' },
  });
  expect(
    await updateProfile(a.headers, { ...input, name: 'Устаревшее' }),
  ).toEqual({ status: 'conflict' });
  expect(await readProfile(a.headers)).toMatchObject({
    name: 'Анна',
    version: '2',
  });
  expect(await readProfile(b.headers)).toMatchObject({
    name: 'Тест',
    version: '1',
  });
  expect(
    await updateProfile(a.headers, {
      ...input,
      expectedVersion: '2',
      userId: b.actorId,
    }),
  ).toMatchObject({ status: 'validation' });
  expect(await updateProfile(new Headers(), input)).toEqual({
    status: 'unauthorized',
  });
  const results = await Promise.all(
    ['Первый', 'Второй'].map((name) =>
      updateProfile(a.headers, { ...input, name, expectedVersion: '2' }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  expect((await readProfile(a.headers)).version).toBe('3');
});
test('Личное пространство изолировано даже при общем семейном членстве, без session и после signout доступа нет', async () => {
  const a = await registeredActor();
  const b = await registeredActor();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.personalOwnerId, a.actorId));
  const orgId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({ id: orgId, name: 'Семья', slug: orgId, createdAt: new Date() });
    await tx.insert(member).values([
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: a.actorId,
        role: 'owner',
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: b.actorId,
        role: 'member',
        createdAt: new Date(),
      },
    ]);
    await tx.insert(workspace).values({
      kind: 'family',
      name: 'Семья',
      organizationId: orgId,
      familyOwnerId: a.actorId,
      timezone: 'Europe/Moscow',
    });
  });
  await expect(
    requireWorkspace(b.actorId, scope!.id, 'read', db),
  ).rejects.toThrow('FORBIDDEN');
  await expect(personalDashboard(new Headers())).rejects.toThrow(
    'UNAUTHORIZED',
  );
  expect((await authRequest('/sign-out', {}, a.headers)).status).toBe(200);
  await expect(currentActor(a.headers)).rejects.toThrow('UNAUTHORIZED');
  await expect(readProfile(a.headers)).rejects.toThrow('UNAUTHORIZED');
  expect(
    (
      await authRequest('/sign-in/email', {
        email: a.email,
        password: a.password,
      })
    ).status,
  ).toBe(200);
});
test('Reset одинаков для известной/неизвестной почты, одноразовый, просроченный отклоняется, старый пароль не работает', async () => {
  const a = await registeredActor();
  const known = await authRequest('/request-password-reset', {
    email: a.email,
    redirectTo: '/reset-password',
  });
  const unknown = await authRequest('/request-password-reset', {
    email: `${randomUUID()}@example.org`,
    redirectTo: '/reset-password',
  });
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  const link = mockMail.messages.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  expect(mockMail.messages.at(-1)!.text).not.toContain(a.password);
  const token = new URL(link).pathname.split('/').at(-1)!;
  const body = { token, newPassword: 'NewStrongPassword123!' };
  expect((await authRequest('/reset-password', body)).status).toBe(200);
  expect((await authRequest('/reset-password', body)).status).not.toBe(200);
  expect(
    (
      await authRequest('/sign-in/email', {
        email: a.email,
        password: a.password,
      })
    ).status,
  ).not.toBe(200);
  expect(
    (
      await authRequest('/sign-in/email', {
        email: a.email,
        password: body.newPassword,
      })
    ).status,
  ).toBe(200);
  await authRequest('/request-password-reset', { email: a.email });
  const expiredLink = mockMail.messages
    .at(-1)!
    .text.match(/https?:\/\/\S+/)![0];
  const expiredToken = new URL(expiredLink).pathname.split('/').at(-1)!;
  await db
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(and(eq(verification.value, a.actorId)));
  expect(
    (await authRequest('/reset-password', { ...body, token: expiredToken }))
      .status,
  ).not.toBe(200);
});
