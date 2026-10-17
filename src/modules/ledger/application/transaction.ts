import 'server-only';
import type { z } from 'zod';
import { validateAmount } from '@/shared/money/decimal';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Transaction } from '@/server/db/client';
import { workspace } from '@/server/db/schema/workspaces';
import { member } from '@/server/db/schema/identity';
import {
  financialAction,
  commandReceipt,
  ledgerLeg,
} from '@/server/db/schema/ledger';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  currentActor,
  requireWorkspace,
  AccessError,
} from '@/server/security/access';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { encryptToken, decryptToken } from '@/server/security/encryption';
import { correlationId, logError } from '@/server/security/logging';
class ConfirmationRequired extends Error {
  constructor(
    readonly result: Extract<
      CommandResult<never>,
      { status: 'confirmation_required' }
    >,
  ) {
    super('CONFIRMATION_REQUIRED');
  }
}
export class CommandValidation extends Error {
  constructor(readonly fieldErrors: Record<string, string[]>) {
    super('VALIDATION');
  }
}
export class CommandConflict extends Error {
  constructor() {
    super('CONFLICT');
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  throw new Error('INVALID_PAYLOAD');
}
export function requestHash(payload: unknown) {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}
export function confirmationFor(
  actorId: string,
  payloadHash: string,
  versions: unknown,
) {
  return encryptToken(
    JSON.stringify({ actorId, payloadHash, versions }),
    'negative-confirmation',
  );
}
export function verifyConfirmation(
  token: string | undefined,
  actorId: string,
  payloadHash: string,
  versions: unknown,
) {
  if (!token) return false;
  try {
    return (
      decryptToken(token, 'negative-confirmation') ===
      JSON.stringify({ actorId, payloadHash, versions })
    );
  } catch {
    return false;
  }
}
type Context<P> = {
  payload: P;
  tx: Transaction;
  actorId: string;
  hash: string;
  accounts: readonly (typeof financialAccount.$inferSelect)[];
  confirmed: boolean;
};
type WriteResult<R> =
  | { reference: R }
  | {
      confirmationBalances: readonly {
        accountId: string;
        amount: string;
        currency: string;
      }[];
    };
export async function financialTransaction<P, R, T>(input: {
  headers: Headers;
  envelope: CommandEnvelope;
  payload: unknown;
  payloadSchema: z.ZodType<P>;
  workspaceIds: readonly string[];
  accountIds: readonly string[];
  actionId?: string;
  allowArchivedAccounts?: boolean;
  execute: (context: Context<P>) => Promise<WriteResult<R>>;
  project: (tx: Transaction, reference: R, actorId: string) => Promise<T>;
}): Promise<CommandResult<T>> {
  let actorId: string;
  try {
    actorId = await currentActor(input.headers);
  } catch (error) {
    return {
      status: error instanceof AccessError ? 'unauthorized' : 'unavailable',
    };
  }
  const parsed = commandEnvelope.safeParse(input.envelope);
  if (!parsed.success) return validationErrors(parsed.error);
  const envelope = parsed.data;
  const normalized = input.payloadSchema.safeParse(input.payload);
  if (!normalized.success) return validationErrors(normalized.error);
  const ids = [
    ...new Set([envelope.workspaceId, ...input.workspaceIds]),
  ].sort();
  const hash = requestHash({
    workspaceIds: ids,
    accountIds: [...new Set(input.accountIds)].sort(),
    actionId: input.actionId,
    payload: normalized.data,
    expectedVersion: envelope.expectedVersion,
  });
  try {
    return await retryTransaction(async (tx) => {
      const scopes = await tx
        .select()
        .from(workspace)
        .where(inArray(workspace.id, ids))
        .orderBy(workspace.id)
        .for('update');
      if (scopes.length !== ids.length) throw new AccessError();
      for (const id of ids) await requireWorkspace(actorId, id, 'write', tx);
      const orgs = scopes
        .flatMap((scope) =>
          scope.organizationId ? [scope.organizationId] : [],
        )
        .sort();
      if (orgs.length)
        await tx
          .select()
          .from(member)
          .where(inArray(member.organizationId, orgs))
          .orderBy(member.id)
          .for('update');
      // Повторная проверка после locks; receipt не восстанавливает отозванные права.
      for (const id of ids) await requireWorkspace(actorId, id, 'write', tx);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorId}:${envelope.operationKey}`},0))`,
      );
      const existing = await tx
        .select()
        .from(commandReceipt)
        .where(
          and(
            eq(commandReceipt.actorId, actorId),
            eq(commandReceipt.operationKey, envelope.operationKey),
          ),
        )
        .for('update');
      if (existing[0]) {
        if (
          existing[0].requestHash !== hash ||
          existing[0].status !== 'completed'
        )
          throw new CommandConflict();
        return {
          status: 'success' as const,
          data: await input.project(tx, existing[0].resultRef as R, actorId),
        };
      }
      const historicalAccounts = new Set<string>();
      if (input.actionId) {
        const [action] = await tx
          .select()
          .from(financialAction)
          .where(eq(financialAction.id, input.actionId))
          .for('update');
        if (!action) throw new AccessError();
        const legs = await tx
          .select()
          .from(ledgerLeg)
          .where(
            and(
              eq(ledgerLeg.actionId, action.id),
              eq(ledgerLeg.revisionNo, action.currentRevision),
            ),
          );
        if (
          !legs.length ||
          legs.some(
            (leg) =>
              !ids.includes(leg.workspaceId) ||
              !input.accountIds.includes(leg.accountId),
          )
        )
          throw new AccessError();
        legs.forEach((leg) => historicalAccounts.add(leg.accountId));
        if (
          !envelope.expectedVersion ||
          action.version.toString() !== envelope.expectedVersion
        )
          throw new CommandConflict();
      }
      const accounts = input.accountIds.length
        ? await tx
            .select()
            .from(financialAccount)
            .where(
              inArray(
                financialAccount.id,
                [...new Set(input.accountIds)].sort(),
              ),
            )
            .orderBy(financialAccount.id)
            .for('update')
        : [];
      if (
        accounts.length !== new Set(input.accountIds).size ||
        accounts.some(
          (account) =>
            !ids.includes(account.workspaceId) ||
            (account.archivedAt &&
              !input.allowArchivedAccounts &&
              !historicalAccounts.has(account.id)),
        )
      )
        throw new AccessError();
      const versions = {
        operationKey: envelope.operationKey,
        workspaces: scopes.map((s) => [s.id, s.version.toString()]),
        accounts: accounts.map((a) => [a.id, a.version.toString()]),
      };
      const confirmed = verifyConfirmation(
        envelope.confirmationToken,
        actorId,
        hash,
        versions,
      );
      await tx.insert(commandReceipt).values({
        actorId,
        operationKey: envelope.operationKey,
        requestHash: hash,
        status: 'pending',
      });
      const result = await input.execute({
        tx,
        actorId,
        hash,
        accounts,
        confirmed,
        payload: normalized.data,
      });
      if ('confirmationBalances' in result) {
        if (
          result.confirmationBalances.some(
            (balance) =>
              !accounts.some(
                (account) =>
                  account.id === balance.accountId &&
                  account.currency === balance.currency,
              ),
          )
        )
          throw new AccessError();
        throw new ConfirmationRequired({
          status: 'confirmation_required',
          confirmationToken: confirmationFor(actorId, hash, versions),
          balances: result.confirmationBalances.map((balance) => ({
            ...balance,
            amount: validateAmount(balance.amount, balance.currency),
          })),
        });
      }
      await tx
        .update(commandReceipt)
        .set({ status: 'completed', resultRef: result.reference })
        .where(
          and(
            eq(commandReceipt.actorId, actorId),
            eq(commandReceipt.operationKey, envelope.operationKey),
          ),
        );
      return {
        status: 'success' as const,
        data: await input.project(tx, result.reference, actorId),
      };
    });
  } catch (error) {
    if (error instanceof ConfirmationRequired) return error.result;
    if (error instanceof AccessError) return { status: 'forbidden' };
    if (error instanceof CommandConflict) return { status: 'conflict' };
    if (error instanceof CommandValidation)
      return { status: 'validation', fieldErrors: error.fieldErrors };
    logError('COMMAND_ERROR', {
      correlationId: correlationId(),
      actorId,
      workspaceId: envelope.workspaceId,
    });
    return { status: 'unavailable' };
  }
}

function retryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && (error.code === '40001' || error.code === '40P01'))
    return true;
  return 'cause' in error && error.cause !== error && retryable(error.cause);
}
async function retryTransaction<T>(
  execute: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb().transaction(execute);
    } catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
    }
  }
}

/** Session-authorized creation/secret response before a workspace can be supplied by the client. */
export async function sessionCommandTransaction<P, R, T>(input: {
  headers: Headers;
  operationKey: string;
  payload: unknown;
  payloadSchema: z.ZodType<P>;
  execute: (tx: Transaction, actorId: string, payload: P) => Promise<R>;
  project: (tx: Transaction, reference: R, actorId: string) => Promise<T>;
}): Promise<CommandResult<T>> {
  let actorId: string;
  try {
    actorId = await currentActor(input.headers);
  } catch (error) {
    return {
      status: error instanceof AccessError ? 'unauthorized' : 'unavailable',
    };
  }
  const key = commandEnvelope.shape.operationKey.safeParse(input.operationKey);
  const parsed = input.payloadSchema.safeParse(input.payload);
  if (!key.success) return validationErrors(key.error);
  if (!parsed.success) return validationErrors(parsed.error);
  const hash = requestHash(parsed.data);
  try {
    return await retryTransaction(async (tx) => {
      const { createAuth } = await import('@/server/auth/auth');
      const session = await createAuth(tx, undefined, true).api.getSession({
        headers: input.headers,
        query: { disableCookieCache: true },
      });
      if (!session || session.user.id !== actorId) throw new AccessError();
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorId}:${key.data}`},0))`,
      );
      const [existing] = await tx
        .select()
        .from(commandReceipt)
        .where(
          and(
            eq(commandReceipt.actorId, actorId),
            eq(commandReceipt.operationKey, key.data),
          ),
        );
      if (existing) {
        if (existing.requestHash !== hash || existing.status !== 'completed')
          throw new CommandConflict();
        return {
          status: 'success' as const,
          data: await input.project(tx, existing.resultRef as R, actorId),
        };
      }
      const reference = await input.execute(tx, actorId, parsed.data);
      await tx.insert(commandReceipt).values({
        actorId,
        operationKey: key.data,
        requestHash: hash,
        status: 'completed',
        resultRef: reference,
      });
      return {
        status: 'success' as const,
        data: await input.project(tx, reference, actorId),
      };
    });
  } catch (error) {
    if (error instanceof AccessError) return { status: 'forbidden' };
    if (error instanceof CommandConflict) return { status: 'conflict' };
    if (error instanceof CommandValidation)
      return { status: 'validation', fieldErrors: error.fieldErrors };
    logError('COMMAND_ERROR', { correlationId: correlationId(), actorId });
    return { status: 'unavailable' };
  }
}
