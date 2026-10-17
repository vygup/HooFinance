import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { workspace } from '@/server/db/schema/workspaces';
import { member, invitation, user } from '@/server/db/schema/identity';
import { ownershipOffer } from '@/server/db/schema/family';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import type { FamilyDto } from '../application/family-input';
export async function familyDto(
  tx: Transaction,
  actorId: string,
  id: string,
  history = false,
): Promise<FamilyDto> {
  const scope = await requireWorkspace(
    actorId,
    id,
    history ? 'history' : 'read',
    tx,
  );
  if (scope.kind !== 'family' || !scope.organizationId) throw new AccessError();
  const role = scope.familyOwnerId === actorId ? 'owner' : 'member';
  const members = scope.deletedAt
    ? []
    : await tx
        .select({
          id: member.id,
          userId: member.userId,
          email: user.email,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, scope.organizationId))
        .orderBy(member.id);
  const invitations =
    !scope.deletedAt && role === 'owner'
      ? await tx
          .select({
            id: invitation.id,
            email: invitation.email,
            status: invitation.status,
          })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, scope.organizationId),
              eq(invitation.status, 'pending'),
            ),
          )
      : [];
  const offers = scope.deletedAt
    ? []
    : await tx
        .select({
          id: ownershipOffer.id,
          recipientId: ownershipOffer.recipientId,
          workspaceVersion: ownershipOffer.workspaceVersion,
        })
        .from(ownershipOffer)
        .where(
          and(
            eq(ownershipOffer.workspaceId, id),
            eq(ownershipOffer.status, 'pending'),
            eq(ownershipOffer.workspaceVersion, scope.version),
          ),
        );
  return {
    id,
    name: scope.name,
    timezone: scope.timezone!,
    version: scope.version.toString(),
    organizationId: scope.organizationId,
    role,
    deleted: !!scope.deletedAt,
    members,
    invitations,
    offers: offers
      .filter((o) => role === 'owner' || o.recipientId === actorId)
      .map((o) => ({ ...o, workspaceVersion: o.workspaceVersion.toString() })),
  };
}
export async function changeWorkspace(
  tx: Transaction,
  id: string,
  expectedVersion: string | undefined,
  changes: Partial<typeof workspace.$inferInsert>,
) {
  if (
    !expectedVersion ||
    !/^[1-9]\d{0,18}$/.test(expectedVersion) ||
    BigInt(expectedVersion) >= 9223372036854775807n
  )
    throw new CommandConflict();
  const changed = await tx
    .update(workspace)
    .set({ ...changes, version: sql`${workspace.version}+1` })
    .where(
      and(eq(workspace.id, id), eq(workspace.version, BigInt(expectedVersion))),
    )
    .returning();
  if (!changed.length) throw new CommandConflict();
  return changed[0]!;
}
export async function auditFamily(
  tx: Transaction,
  actorId: string,
  id: string,
  kind: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(scopedAuditEvent).values({
    workspaceId: id,
    objectType: 'workspace',
    objectId: id,
    actorId,
    revisionNo: 1,
    kind,
    beforeScope: before,
    afterScope: after,
  });
}
/** The Organization Plugin's last-owner guard cannot express a confirmed two-role swap.
 * Domain adapter changes its native member rows together; deferred owner trigger validates commit. */
export async function swapOwner(
  tx: Transaction,
  orgId: string,
  previous: string,
  next: string,
) {
  await tx
    .update(member)
    .set({ role: 'member' })
    .where(and(eq(member.organizationId, orgId), eq(member.userId, previous)));
  await tx
    .update(member)
    .set({ role: 'owner' })
    .where(and(eq(member.organizationId, orgId), eq(member.userId, next)));
}
