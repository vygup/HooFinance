import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Transaction } from '@/server/db/client';
import { user, userProfile } from '@/server/db/schema/identity';
import { workspace } from '@/server/db/schema/workspaces';
import type { profileInput, ProfileDto } from '../domain/registration';
import type { z } from 'zod';
export async function provisionPersonal(
  created: { id: string },
  tx: Transaction,
) {
  await tx.insert(workspace).values({
    kind: 'personal',
    personalOwnerId: created.id,
    name: 'Личное пространство',
  });
  await tx.insert(userProfile).values({ userId: created.id });
}
export async function findProfile(
  actorId: string,
  tx: Transaction,
): Promise<ProfileDto> {
  const [found] = await tx
    .select({
      name: user.name,
      email: user.email,
      locale: userProfile.locale,
      timezone: userProfile.timezone,
      version: userProfile.version,
    })
    .from(userProfile)
    .innerJoin(user, eq(user.id, userProfile.userId))
    .where(eq(userProfile.userId, actorId));
  if (!found) throw new Error('PROFILE_NOT_FOUND');
  return { ...found, version: found.version.toString() };
}
export async function saveProfile(
  actorId: string,
  input: z.infer<typeof profileInput>,
) {
  return getDb().transaction(async (tx) => {
    // Profile row is the shared lock for name and preferences; one version covers both.
    const changed = await tx
      .update(userProfile)
      .set({
        locale: input.locale,
        timezone: input.timezone,
        version: sql`${userProfile.version} + 1`,
      })
      .where(
        and(
          eq(userProfile.userId, actorId),
          eq(userProfile.version, BigInt(input.expectedVersion)),
        ),
      )
      .returning({ id: userProfile.userId });
    if (!changed.length) return { status: 'conflict' as const };
    await tx
      .update(user)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(user.id, actorId));
    return { status: 'success' as const, data: await findProfile(actorId, tx) };
  });
}
