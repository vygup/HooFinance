import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createAuth } from '@/server/auth/auth';
import { organizationContext } from '@/server/auth/context';
import { getMailTransport, type MailTransport } from '@/server/mail/transport';
import {
  currentActor,
  requireWorkspace,
  AccessError,
} from '@/server/security/access';
import { readSnapshot } from '@/server/db/read-snapshot';
import { workspace } from '@/server/db/schema/workspaces';
import {
  invitation,
  member,
  user,
  userProfile,
} from '@/server/db/schema/identity';
import { ownershipOffer } from '@/server/db/schema/family';
import { decryptToken } from '@/server/security/encryption';
import {
  financialTransaction,
  sessionCommandTransaction,
  CommandConflict,
} from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import {
  familyDto,
  changeWorkspace,
  swapOwner,
  auditFamily,
} from '../infrastructure/family-repository';
import {
  createFamilyInput,
  familyInput,
  invitationResponseInput,
} from './family-input';

export async function createFamily(
  headers: Headers,
  input: unknown,
  mail: MailTransport = getMailTransport(),
) {
  const parsed = createFamilyInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  return sessionCommandTransaction({
    headers,
    operationKey: parsed.data.operationKey,
    payload: { command: 'createFamily', ...parsed.data },
    payloadSchema: createFamilyInput.extend({
      command: z.literal('createFamily'),
    }),
    execute: async (tx, actorId, payload) => {
      const auth = createAuth(tx, mail, true);
      const org = await organizationContext.run(
        {
          actorId,
          workspaceId: null,
          organizationId: null,
          paths: ['/organization/create'],
        },
        () =>
          auth.api.createOrganization({
            headers,
            body: {
              name: payload.name,
              slug: randomUUID(),
              keepCurrentActiveOrganization: true,
            },
          }),
      );
      if (!org) throw new Error('CREATE_FAILED');
      const [profile] = await tx
        .select({ timezone: userProfile.timezone })
        .from(userProfile)
        .where(eq(userProfile.userId, actorId));
      if (!profile) throw new AccessError();
      const [scope] = await tx
        .insert(workspace)
        .values({
          kind: 'family',
          name: payload.name,
          organizationId: org.id,
          familyOwnerId: actorId,
          timezone: payload.timezone ?? profile.timezone,
        })
        .returning();
      if (!scope) throw new Error('CREATE_FAILED');
      await auditFamily(tx, actorId, scope.id, 'create', null, {
        name: scope.name,
        timezone: scope.timezone,
        version: '1',
      });
      return scope.id;
    },
    project: (tx, id, actorId) => familyDto(tx, actorId, id),
  });
}
export async function familyCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
  mail: MailTransport = getMailTransport(),
) {
  const parsed = familyInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  const env = commandEnvelope.safeParse(envelope);
  if (!env.success) return validationErrors(env.error);
  const payload = parsed.data;
  return financialTransaction({
    headers,
    envelope: env.data,
    payload,
    payloadSchema: familyInput,
    workspaceIds: [],
    accountIds: [],
    execute: async ({ tx, actorId }) => {
      const id = env.data.workspaceId;
      const memberCommand =
        payload.command === 'leave' || payload.command === 'acceptOwnership';
      const scope = await requireWorkspace(
        actorId,
        id,
        memberCommand ? 'write' : 'owner',
        tx,
      );
      if (scope.kind !== 'family' || !scope.organizationId)
        throw new AccessError();
      const orgId = scope.organizationId;
      const auth = createAuth(tx, mail, true);
      const native = <T>(path: string, call: () => Promise<T>) =>
        organizationContext.run(
          { actorId, workspaceId: id, organizationId: orgId, paths: [path] },
          call,
        );
      const expected = env.data.expectedVersion;
      const versioned = [
        'rename',
        'timezone',
        'offer',
        'acceptOwnership',
        'delete',
      ].includes(payload.command);
      if (versioned && (!expected || expected !== scope.version.toString()))
        throw new CommandConflict();
      let offerId: string | undefined;
      switch (payload.command) {
        case 'rename':
          await native('/organization/update', () =>
            auth.api.updateOrganization({
              headers,
              body: { organizationId: orgId, data: { name: payload.name } },
            }),
          );
          await changeWorkspace(tx, id, expected, { name: payload.name });
          break;
        case 'timezone':
          await changeWorkspace(tx, id, expected, {
            timezone: payload.timezone,
          });
          break;
        case 'invite':
          await native('/organization/invite-member', () =>
            auth.api.createInvitation({
              headers,
              body: {
                organizationId: orgId,
                email: payload.email,
                role: 'member',
              },
            }),
          );
          break;
        case 'cancelInvite': {
          const [found] = await tx
            .select()
            .from(invitation)
            .where(
              and(
                eq(invitation.id, payload.invitationId),
                eq(invitation.organizationId, orgId),
                eq(invitation.status, 'pending'),
              ),
            );
          if (!found) throw new AccessError();
          await native('/organization/cancel-invitation', () =>
            auth.api.cancelInvitation({
              headers,
              body: { invitationId: found.id },
            }),
          );
          break;
        }
        case 'remove': {
          const [found] = await tx
            .select()
            .from(member)
            .where(
              and(
                eq(member.id, payload.memberId),
                eq(member.organizationId, orgId),
              ),
            );
          if (!found || found.role === 'owner') throw new AccessError();
          await native('/organization/remove-member', () =>
            auth.api.removeMember({
              headers,
              body: { organizationId: orgId, memberIdOrEmail: found.id },
            }),
          );
          await tx
            .update(ownershipOffer)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(ownershipOffer.workspaceId, id),
                eq(ownershipOffer.recipientId, found.userId),
                eq(ownershipOffer.status, 'pending'),
              ),
            );
          break;
        }
        case 'leave':
          if (scope.familyOwnerId === actorId) throw new AccessError();
          await native('/organization/leave', () =>
            auth.api.leaveOrganization({
              headers,
              body: { organizationId: orgId },
            }),
          );
          await tx
            .update(ownershipOffer)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(ownershipOffer.workspaceId, id),
                eq(ownershipOffer.recipientId, actorId),
                eq(ownershipOffer.status, 'pending'),
              ),
            );
          break;
        case 'offer': {
          const [recipient] = await tx
            .select()
            .from(member)
            .where(
              and(
                eq(member.organizationId, orgId),
                eq(member.userId, payload.recipientId),
                eq(member.role, 'member'),
              ),
            );
          if (!recipient) throw new AccessError();
          await tx
            .update(ownershipOffer)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(ownershipOffer.workspaceId, id),
                eq(ownershipOffer.status, 'pending'),
              ),
            );
          const [offer] = await tx
            .insert(ownershipOffer)
            .values({
              workspaceId: id,
              initiatorId: actorId,
              recipientId: recipient.userId,
              workspaceVersion: scope.version,
            })
            .returning();
          offerId = offer!.id;
          break;
        }
        case 'cancelOffer': {
          const changed = await tx
            .update(ownershipOffer)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(ownershipOffer.id, payload.offerId),
                eq(ownershipOffer.workspaceId, id),
                eq(ownershipOffer.status, 'pending'),
              ),
            )
            .returning();
          if (!changed.length) throw new CommandConflict();
          break;
        }
        case 'acceptOwnership': {
          const [offer] = await tx
            .select()
            .from(ownershipOffer)
            .where(
              and(
                eq(ownershipOffer.id, payload.offerId),
                eq(ownershipOffer.workspaceId, id),
              ),
            )
            .for('update');
          if (!offer || offer.recipientId !== actorId) throw new AccessError();
          if (
            offer.status !== 'pending' ||
            offer.workspaceVersion !== scope.version ||
            offer.initiatorId !== scope.familyOwnerId
          )
            throw new CommandConflict();
          const [recipient] = await tx
            .select()
            .from(member)
            .where(
              and(
                eq(member.organizationId, orgId),
                eq(member.userId, actorId),
                eq(member.role, 'member'),
              ),
            );
          if (!recipient) throw new AccessError();
          await swapOwner(tx, orgId, scope.familyOwnerId!, actorId);
          await changeWorkspace(tx, id, expected, { familyOwnerId: actorId });
          await tx
            .update(ownershipOffer)
            .set({ status: 'accepted', updatedAt: new Date() })
            .where(eq(ownershipOffer.id, offer.id));
          break;
        }
        case 'delete': {
          const members = await tx
            .select()
            .from(member)
            .where(eq(member.organizationId, orgId));
          if (members.length !== 1 || members[0]!.userId !== actorId)
            throw new AccessError();
          await changeWorkspace(tx, id, expected, {
            deletedAt: new Date(),
            deletedBy: actorId,
          });
          await tx
            .update(invitation)
            .set({ status: 'canceled' })
            .where(
              and(
                eq(invitation.organizationId, orgId),
                eq(invitation.status, 'pending'),
              ),
            );
          await tx
            .update(ownershipOffer)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(ownershipOffer.workspaceId, id),
                eq(ownershipOffer.status, 'pending'),
              ),
            );
          break;
        }
      }
      const [after] = await tx
        .select()
        .from(workspace)
        .where(eq(workspace.id, id));
      const snapshot = (row: typeof scope) => ({
        name: row.name,
        timezone: row.timezone,
        ownerId: row.familyOwnerId,
        version: row.version.toString(),
        deleted: !!row.deletedAt,
      });
      await auditFamily(tx, actorId, id, payload.command, snapshot(scope), {
        ...snapshot(after!),
        command: payload.command,
        ...(offerId ? { offerId } : {}),
      });
      return { reference: { id, offerId, command: payload.command } };
    },
    project: async (tx, ref, actorId) => {
      // A leave returns no family details; subsequent retries are denied by the executor.
      if (ref.command === 'leave')
        return { id: ref.id, version: '', offerId: ref.offerId };
      const scope = await requireWorkspace(
        actorId,
        ref.id,
        ref.command === 'delete' ? 'history' : 'read',
        tx,
      );
      if (!['acceptOwnership', 'delete'].includes(ref.command))
        await requireWorkspace(actorId, ref.id, 'owner', tx);
      return {
        id: scope.id,
        version: scope.version.toString(),
        offerId: ref.offerId,
      };
    },
  });
}
export async function respondFamilyInvitation(
  headers: Headers,
  input: unknown,
) {
  const parsed = invitationResponseInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  return sessionCommandTransaction({
    headers,
    operationKey: parsed.data.operationKey,
    payload: parsed.data,
    payloadSchema: invitationResponseInput,
    execute: async (tx, actorId, payload) => {
      let invitationId: string;
      try {
        invitationId = decryptToken(payload.secret, 'invitation-link');
      } catch {
        throw new AccessError();
      }
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
      if (!scope || scope.deletedAt) throw new AccessError();
      await tx
        .select()
        .from(member)
        .where(eq(member.organizationId, found.organizationId))
        .orderBy(member.id)
        .for('update');
      const [pending] = await tx
        .select()
        .from(invitation)
        .where(eq(invitation.id, invitationId))
        .for('update');
      const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
      if (
        !actor ||
        !pending ||
        pending.email !== actor.email ||
        pending.status !== 'pending' ||
        pending.expiresAt.getTime() <= Date.now()
      )
        throw new AccessError();
      const auth = createAuth(tx, undefined, true),
        path =
          payload.decision === 'accept'
            ? '/organization/accept-invitation'
            : '/organization/reject-invitation';
      await organizationContext.run(
        {
          actorId,
          workspaceId: scope.id,
          organizationId: scope.organizationId,
          paths: [path],
        },
        () =>
          payload.decision === 'accept'
            ? auth.api.acceptInvitation({ headers, body: { invitationId } })
            : auth.api.rejectInvitation({ headers, body: { invitationId } }),
      );
      await auditFamily(tx, actorId, scope.id, payload.decision, null, {
        invitationId,
      });
      return { id: scope.id, invitationId, decision: payload.decision };
    },
    project: async (tx, ref, actorId) => {
      const [scope] = await tx
        .select()
        .from(workspace)
        .where(eq(workspace.id, ref.id));
      const [invite] = await tx
        .select()
        .from(invitation)
        .where(eq(invitation.id, ref.invitationId));
      const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
      if (
        !scope ||
        scope.deletedAt ||
        !invite ||
        !actor ||
        invite.email !== actor.email
      )
        throw new AccessError();
      if (ref.decision === 'accept')
        await requireWorkspace(actorId, ref.id, 'read', tx);
      return { id: ref.id };
    },
  });
}
export async function readFamilies(headers: Headers) {
  const actorId = await currentActor(headers);
  return readSnapshot(async (tx) => {
    const scopes = await tx
      .selectDistinct({
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind,
        deletedAt: workspace.deletedAt,
      })
      .from(workspace)
      .leftJoin(
        member,
        and(
          eq(member.organizationId, workspace.organizationId),
          eq(member.userId, actorId),
        ),
      )
      .where(
        or(
          eq(workspace.personalOwnerId, actorId),
          and(isNull(workspace.deletedAt), eq(member.userId, actorId)),
          eq(workspace.deletedBy, actorId),
        ),
      )
      .orderBy(workspace.name);
    return {
      active: scopes
        .filter((s) => !s.deletedAt)
        .map(({ id, name, kind }) => ({ id, name, kind })),
      deleted: scopes
        .filter((s) => !!s.deletedAt)
        .map(({ id, name, kind }) => ({ id, name, kind })),
      actorId,
    };
  });
}
export async function readFamily(
  headers: Headers,
  id: string,
  history = false,
) {
  if (!z.uuid().safeParse(id).success) throw new AccessError();
  const actorId = await currentActor(headers);
  return readSnapshot((tx) => familyDto(tx, actorId, id, history));
}
