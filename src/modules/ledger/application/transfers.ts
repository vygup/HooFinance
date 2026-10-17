import 'server-only';
import type { z } from 'zod';
import type { Transaction } from '@/server/db/client';
import type { TransferInput } from '../domain/transfers';
import { and, eq, isNull } from 'drizzle-orm';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { AccessError } from '@/server/security/access';
import { workspace } from '@/server/db/schema/workspaces';
import { financialAccount } from '@/server/db/schema/accounts';
import { financialAction, ledgerLeg } from '@/server/db/schema/ledger';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { readFamilies } from '@/modules/workspaces/application/family';
import { transferInput } from './transfers-input';
import {
  acceptTransfer,
  type TransferDto,
  type TransferAccountOption,
} from '../domain/transfers';
import { needsNegativeWarning } from '../domain/accounts';
import { financialTransaction, CommandValidation } from './transaction';
import {
  saveTransfer,
  projectTransfer,
} from '../infrastructure/transfers-repository';
export async function createTransfer(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<TransferDto>> {
  const p = transferInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return executeTransfer(headers, e.data, p.data, transferInput, {
    project: (tx, id, actorId) =>
      projectTransfer(tx, id, e.data.workspaceId, actorId),
  });
}
/** Shared ledger path; optional domain guard runs under the same scope/account locks. */
export async function executeTransfer<P extends TransferInput, T>(
  headers: Headers,
  envelope: CommandEnvelope,
  payload: P,
  payloadSchema: z.ZodType<P>,
  options: {
    beforeWrite?: (tx: Transaction, actorId: string) => Promise<void>;
    project: (tx: Transaction, id: string, actorId: string) => Promise<T>;
  },
): Promise<CommandResult<T>> {
  const e = commandEnvelope.safeParse(envelope);
  if (!e.success) return validationErrors(e.error);
  if (
    ![payload.sourceWorkspaceId, payload.destinationWorkspaceId].includes(
      e.data.workspaceId,
    )
  )
    return { status: 'forbidden' };
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema,
    workspaceIds: [payload.sourceWorkspaceId, payload.destinationWorkspaceId],
    accountIds: [payload.sourceAccountId, payload.destinationAccountId],
    execute: async ({ tx, actorId, accounts, confirmed }) => {
      const source = accounts.find((a) => a.id === payload.sourceAccountId),
        destination = accounts.find(
          (a) => a.id === payload.destinationAccountId,
        );
      if (
        !source ||
        !destination ||
        source.workspaceId !== payload.sourceWorkspaceId ||
        destination.workspaceId !== payload.destinationWorkspaceId
      )
        throw new AccessError();
      await options.beforeWrite?.(tx, actorId);
      if (source.workspaceId !== destination.workspaceId) {
        const scopes = await tx
          .select()
          .from(workspace)
          .where(eq(workspace.id, source.workspaceId));
        const [other] = await tx
          .select()
          .from(workspace)
          .where(eq(workspace.id, destination.workspaceId));
        const personal = [scopes[0], other].find((s) => s?.kind === 'personal'),
          family = [scopes[0], other].find((s) => s?.kind === 'family');
        if (!personal || !family || personal.personalOwnerId !== actorId)
          throw new AccessError();
      }
      let accepted;
      try {
        accepted = acceptTransfer(
          source.balanceProjection,
          destination.balanceProjection,
          source.currency,
          destination.currency,
          payload.debitAmount,
          payload.creditAmount,
        );
      } catch {
        throw new CommandValidation({
          debitAmount: [
            'Проверьте валюты, равенство и точность сумм. Переводы с конвертацией пока недоступны.',
          ],
        });
      }
      if (
        needsNegativeWarning(
          source.balanceProjection,
          accepted.sourceBalance,
        ) &&
        !confirmed
      )
        return {
          confirmationBalances: [
            {
              accountId: source.id,
              amount: accepted.sourceBalance,
              currency: source.currency,
            },
          ],
        };
      return {
        reference: await saveTransfer(
          tx,
          actorId,
          e.data.operationKey,
          source,
          destination,
          payload,
          accepted,
        ),
      };
    },
    project: options.project,
  });
}
export async function readTransfers(headers: Headers, workspaceId: string) {
  if (!commandEnvelope.shape.workspaceId.safeParse(workspaceId).success)
    throw new AccessError();
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => {
      const rows = await tx
        .selectDistinct({ id: ledgerLeg.actionId })
        .from(ledgerLeg)
        .innerJoin(
          financialAction,
          and(
            eq(financialAction.id, ledgerLeg.actionId),
            eq(financialAction.currentRevision, ledgerLeg.revisionNo),
            eq(financialAction.kind, 'transfer'),
            eq(financialAction.status, 'active'),
          ),
        )
        .where(eq(ledgerLeg.workspaceId, workspaceId))
        .orderBy(ledgerLeg.actionId);
      const results: TransferDto[] = [];
      for (const row of rows)
        results.push(await projectTransfer(tx, row.id, workspaceId, actorId));
      return results;
    },
  );
}
export async function readTransferOptions(
  headers: Headers,
  workspaceId: string,
  includeArchived = false,
): Promise<TransferAccountOption[]> {
  const scopes = await readFamilies(headers);
  const active = scopes.active.find((s) => s.id === workspaceId);
  if (!active) throw new AccessError();
  const result: TransferAccountOption[] = [];
  for (const scope of scopes.active) {
    // Cross-space is strictly personal↔family, never family↔family.
    if (scope.id !== workspaceId && scope.kind === active.kind) continue;
    const rows = await readWorkspaceSnapshot(headers, scope.id, ({ tx }) =>
      tx
        .select({
          id: financialAccount.id,
          name: financialAccount.name,
          currency: financialAccount.currency,
          archivedAt: financialAccount.archivedAt,
        })
        .from(financialAccount)
        .where(
          and(
            eq(financialAccount.workspaceId, scope.id),
            includeArchived ? undefined : isNull(financialAccount.archivedAt),
          ),
        )
        .orderBy(financialAccount.name, financialAccount.id),
    );
    result.push(
      ...rows.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        archived: !!a.archivedAt,
        workspaceId: scope.id,
        workspaceName: scope.name,
        kind: scope.kind,
      })),
    );
  }
  return result;
}
