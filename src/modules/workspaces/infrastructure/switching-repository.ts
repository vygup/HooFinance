import 'server-only';
import { eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { userProfile } from '@/server/db/schema/identity';
import { workspace } from '@/server/db/schema/workspaces';
import { calendarContext } from '../domain/switching';
export async function selectedSpace(
  tx: Transaction,
  actorId: string,
  id: string,
  instant: Date,
) {
  const [candidate] = await tx
    .select({ deletedAt: workspace.deletedAt })
    .from(workspace)
    .where(eq(workspace.id, id));
  const scope = await requireWorkspace(
    actorId,
    id,
    candidate?.deletedAt ? 'history' : 'read',
    tx,
  );
  const [profile] = await tx
    .select({ timezone: userProfile.timezone })
    .from(userProfile)
    .where(eq(userProfile.userId, actorId));
  if (!profile || (scope.kind !== 'personal' && scope.kind !== 'family'))
    throw new AccessError();
  return {
    id: scope.id,
    name: scope.name,
    kind: scope.kind,
    readonly: !!scope.deletedAt,
    version: scope.version.toString(),
    canChangeTimezone:
      !scope.deletedAt &&
      scope.kind === 'family' &&
      scope.familyOwnerId === actorId,
    ...calendarContext(scope.kind, scope.timezone, profile.timezone, instant),
  };
}
