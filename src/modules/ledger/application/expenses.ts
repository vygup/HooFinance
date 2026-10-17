import 'server-only';
import type { z } from 'zod';
import type { Transaction } from '@/server/db/client';
type ExpenseInput = z.infer<typeof expenseInput>;
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { AccessError } from '@/server/security/access';
import {
  expenseInput,
  acceptExpense,
} from '@/modules/categories/domain/expenses';
import type { IncomeDto } from '../domain/income';
import {
  incomeCategory as resolveCategory,
  saveIncome as saveEntry,
  projectIncome as projectEntry,
} from '../infrastructure/income-repository';
import { financialTransaction, CommandValidation } from './transaction';
export async function createExpense(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<IncomeDto>> {
  return executeExpense(headers, envelope, input, expenseInput, {
    project: (tx, id, actorId) =>
      projectEntry(tx, id, envelope.workspaceId, actorId, 'expense'),
  });
}
export async function executeExpense<P extends ExpenseInput, T>(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
  schema: z.ZodType<P>,
  options: {
    beforeWrite?: (tx: Transaction, payload: P) => Promise<void>;
    project: (tx: Transaction, id: string, actorId: string) => Promise<T>;
  },
): Promise<CommandResult<T>> {
  const parsed = schema.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!parsed.success) return validationErrors(parsed.error);
  if (!e.success) return validationErrors(e.error);
  const payload = parsed.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: schema,
    workspaceIds: [e.data.workspaceId],
    accountIds: [payload.accountId],
    execute: async ({ tx, actorId, accounts, confirmed }) => {
      const account = accounts[0];
      if (!account || account.workspaceId !== e.data.workspaceId)
        throw new AccessError();
      await options.beforeWrite?.(tx, payload);
      let accepted;
      try {
        accepted = acceptExpense(
          account.balanceProjection,
          payload.amount,
          account.currency,
        );
      } catch {
        throw new CommandValidation({
          amount: ['Проверьте точность суммы для валюты счёта'],
        });
      }
      const categoryId = await resolveCategory(
        tx,
        e.data.workspaceId,
        payload.category,
        actorId,
        'expense',
      );
      if (accepted.warning && !confirmed)
        return {
          confirmationBalances: [
            {
              accountId: account.id,
              amount: accepted.balance,
              currency: account.currency,
            },
          ],
        };
      return {
        reference: await saveEntry(
          tx,
          actorId,
          e.data.workspaceId,
          e.data.operationKey,
          account,
          payload,
          categoryId,
          accepted,
          'expense',
        ),
      };
    },
    project: options.project,
  });
}

export { readExpenses } from '@/modules/categories/application/expenses';
