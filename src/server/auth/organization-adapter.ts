import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { workspace } from '@/server/db/schema/workspaces';
import { createAuth } from './auth';
import { organizationContext } from './context';
import {
  currentActor,
  requireWorkspace,
  AccessError,
} from '@/server/security/access';
import { getMailTransport, type MailTransport } from '@/server/mail/transport';
/** Library API исполняется локально на переданном Drizzle tx, без HTTP. */
export async function organizationTransaction<T>(
  headers: Headers,
  workspaceId: string | null,
  paths: readonly string[],
  execute: (context: {
    tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
    auth: ReturnType<typeof createAuth>;
    actorId: string;
  }) => Promise<T>,
  mail: MailTransport = getMailTransport(),
) {
  const actorId = await currentActor(headers);
  return getDb().transaction(async (tx) => {
    let organizationId: string | null = null;
    if (workspaceId) {
      await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .for('update');
      const scope = await requireWorkspace(actorId, workspaceId, 'owner', tx);
      if (scope.kind !== 'family') throw new AccessError();
      organizationId = scope.organizationId;
    } else if (paths.some((path) => path !== '/organization/create'))
      throw new AccessError();
    const auth = createAuth(tx, mail, true);
    const session = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (!session || session.user.id !== actorId)
      throw new AccessError('UNAUTHORIZED');
    return organizationContext.run(
      { actorId, workspaceId, organizationId, paths },
      () => execute({ tx, auth, actorId }),
    );
  });
}

/** Secret URL не совпадает с отображаемым invitation id; принятие одноразовое. */
export async function respondToInvitation(
  headers: Headers,
  secret: string,
  decision: 'accept' | 'reject',
) {
  const { decryptToken } = await import('@/server/security/encryption');
  const { invitation, member } = await import('@/server/db/schema/identity');
  const { and } = await import('drizzle-orm');
  const actorId = await currentActor(headers);
  let invitationId: string;
  try {
    invitationId = decryptToken(secret, 'invitation-link');
  } catch {
    throw new AccessError();
  }
  return getDb().transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId));
    if (!found) throw new AccessError();
    const [scope] = await tx
      .select()
      .from(workspace)
      .where(eq(workspace.organizationId, found.organizationId))
      .for('update');
    if (!scope || scope.deletedAt || scope.kind !== 'family')
      throw new AccessError();
    await tx
      .select()
      .from(member)
      .where(eq(member.organizationId, found.organizationId))
      .orderBy(member.id)
      .for('update');
    const [pending] = await tx
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, found.organizationId),
        ),
      )
      .for('update');
    const auth = createAuth(tx, undefined, true);
    const session = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (
      !session ||
      session.user.id !== actorId ||
      !pending ||
      pending.status !== 'pending' ||
      pending.expiresAt.getTime() <= Date.now() ||
      pending.email !== session.user.email
    )
      throw new AccessError();
    const path =
      decision === 'accept'
        ? '/organization/accept-invitation'
        : '/organization/reject-invitation';
    await organizationContext.run(
      {
        actorId,
        workspaceId: scope.id,
        organizationId: scope.organizationId,
        paths: [path],
      },
      async () => {
        if (decision === 'accept')
          await auth.api.acceptInvitation({ headers, body: { invitationId } });
        else
          await auth.api.rejectInvitation({ headers, body: { invitationId } });
      },
    );
    return { workspaceId: scope.id };
  });
}
