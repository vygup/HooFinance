import 'server-only';
import { and, eq } from 'drizzle-orm';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { category } from '@/server/db/schema/categories';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { AccessError, requireWorkspace } from '@/server/security/access';
import { readAccountsInSnapshot } from './accounts';
import { readCategoriesInSnapshot } from '@/modules/categories/application/expenses';
import { historyInput, historyFilters } from './history-corrections-input';
import {
  correctionBalances,
  type HistoryAction,
  type HistoryLeg,
} from '../domain/history-corrections';
import { needsNegativeWarning } from '../domain/accounts';
import { acceptTransfer } from '../domain/transfers';
import { validateAmount } from '@/shared/money/decimal';
import {
  currentAction,
  historyLeg,
  saveCorrection,
  historyInSnapshot,
  projectHistoryAction,
} from '../infrastructure/history-corrections-repository';
import {
  financialTransaction,
  CommandConflict,
  CommandValidation,
} from './transaction';

export async function historyCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<HistoryAction>> {
  const p = historyInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  const payload = p.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: historyInput,
    workspaceIds: [e.data.workspaceId],
    accountIds:
      payload.command === 'delete'
        ? []
        : payload.command === 'updateEntry'
          ? [payload.accountId]
          : [payload.sourceAccountId, payload.destinationAccountId],
    actionId: payload.actionId,
    discoverActionLocks: true,
    execute: async ({ tx, actorId, accounts, confirmed }) => {
      const { action, legs } = await currentAction(tx, payload.actionId);
      if (action.status !== 'active') throw new CommandConflict();
      if (!legs.some((l) => l.workspaceId === e.data.workspaceId))
        throw new AccessError();
      const before = legs.map(historyLeg);
      const scopes = [];
      for (const id of new Set(before.map((l) => l.workspaceId)))
        scopes.push(await requireWorkspace(actorId, id, 'write', tx));
      if (
        scopes.length > 1 &&
        !(
          scopes.length === 2 &&
          scopes.some(
            (s) => s.kind === 'personal' && s.personalOwnerId === actorId,
          ) &&
          scopes.some((s) => s.kind === 'family')
        )
      )
        throw new AccessError();
      let after: HistoryLeg[] = before;
      if (payload.command === 'updateEntry') {
        if (!['income', 'expense'].includes(action.kind) || before.length !== 1)
          throw new AccessError();
        const old = before[0]!,
          account = accounts.find((a) => a.id === payload.accountId);
        if (
          !account ||
          account.workspaceId !== old.workspaceId ||
          account.currency !== old.currency
        )
          throw new AccessError();
        const [cat] = await tx
          .select()
          .from(category)
          .where(
            and(
              eq(category.id, payload.categoryId),
              eq(category.workspaceId, old.workspaceId),
            ),
          )
          .for('update');
        if (
          !cat ||
          cat.kind !== action.kind ||
          (cat.archivedAt && cat.id !== old.categoryId)
        )
          throw new AccessError();
        try {
          after = [
            {
              ...old,
              accountId: account.id,
              categoryId: cat.id,
              amount: validateAmount(payload.amount, old.currency),
              financialDate: payload.financialDate,
              description: payload.description,
            },
          ];
        } catch {
          throw new CommandValidation({ amount: ['Проверьте точность суммы'] });
        }
      } else if (payload.command === 'updateTransfer') {
        if (action.kind !== 'transfer') throw new AccessError();
        const source = before.find((l) => l.role === 'transfer_out')!,
          destination = before.find((l) => l.role === 'transfer_in')!;
        if (
          payload.sourceWorkspaceId !== source.workspaceId ||
          payload.destinationWorkspaceId !== destination.workspaceId
        )
          throw new AccessError();
        const src = accounts.find((a) => a.id === payload.sourceAccountId),
          dst = accounts.find((a) => a.id === payload.destinationAccountId);
        if (
          !src ||
          !dst ||
          src.workspaceId !== source.workspaceId ||
          dst.workspaceId !== destination.workspaceId ||
          src.currency !== source.currency ||
          dst.currency !== destination.currency
        )
          throw new AccessError();
        try {
          const accepted = acceptTransfer(
            '0',
            '0',
            src.currency,
            dst.currency,
            payload.debitAmount,
            payload.creditAmount,
          );
          after = [
            {
              ...source,
              accountId: src.id,
              amount: accepted.debit,
              financialDate: payload.financialDate,
              description: payload.sourceDescription,
            },
            {
              ...destination,
              accountId: dst.id,
              amount: accepted.credit,
              financialDate: payload.financialDate,
              description: payload.destinationDescription,
            },
          ];
        } catch {
          throw new CommandValidation({
            debitAmount: ['Проверьте валюты и равенство сумм'],
          });
        }
      }
      const deleting = payload.command === 'delete';
      const balances = correctionBalances(
        accounts,
        before,
        deleting ? [] : after,
      );
      const warnings = balances.filter((b) =>
        needsNegativeWarning(
          accounts.find((a) => a.id === b.accountId)!.balanceProjection,
          b.amount,
        ),
      );
      if (warnings.length && !confirmed)
        return { confirmationBalances: warnings };
      return {
        reference: await saveCorrection(
          tx,
          actorId,
          e.data.operationKey,
          action,
          before,
          after,
          balances,
          deleting,
        ),
      };
    },
    project: (tx, id, actorId) =>
      projectHistoryAction(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readHistory(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  const filters = historyFilters.parse(input);
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => ({
      actions: await historyInSnapshot(tx, actorId, workspaceId, filters),
      accounts: (
        await readAccountsInSnapshot(tx, workspaceId, actorId)
      ).accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        workspaceId,
        archived: a.archived,
      })),
      categories: await readCategoriesInSnapshot(tx, workspaceId),
    }),
  );
}
