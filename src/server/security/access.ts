import 'server-only';
import { and, eq } from 'drizzle-orm';
import { commandEnvelope } from '@/shared/contracts/commands';
import { getDb, type DbExecutor } from '@/server/db/client';
import { workspace } from '@/server/db/schema/workspaces';
import { member } from '@/server/db/schema/identity';
import { getAuth } from '@/server/auth/auth';
export class AccessError extends Error {
  constructor(
    public readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' = 'FORBIDDEN',
  ) {
    super(code);
  }
}
export async function currentActor(headers: Headers) {
  const session = await getAuth().api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) throw new AccessError('UNAUTHORIZED');
  return session.user.id;
}
export async function requireWorkspace(
  actorId: string,
  workspaceId: string,
  mode: 'read' | 'write' | 'owner' | 'history' = 'read',
  db: DbExecutor = getDb(),
) {
  if (!commandEnvelope.shape.workspaceId.safeParse(workspaceId).success)
    throw new AccessError();
  const [scope] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!scope) throw new AccessError();
  if (scope.kind === 'personal') {
    if (scope.personalOwnerId !== actorId) throw new AccessError();
    return scope;
  }
  if (scope.kind !== 'family' || !scope.organizationId) throw new AccessError();
  if (scope.deletedAt) {
    if (mode !== 'history' || scope.deletedBy !== actorId)
      throw new AccessError();
    return scope;
  }
  const [membership] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, scope.organizationId),
        eq(member.userId, actorId),
      ),
    );
  if (!membership || !['owner', 'member'].includes(membership.role))
    throw new AccessError();
  if (
    mode === 'owner' &&
    (membership.role !== 'owner' || scope.familyOwnerId !== actorId)
  )
    throw new AccessError();
  return scope;
}
