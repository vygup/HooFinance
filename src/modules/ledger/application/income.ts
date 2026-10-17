import {
  readCategoriesInSnapshot,
  readExpensesInSnapshot,
} from '@/modules/categories/application/expenses';
import type { Transaction } from '@/server/db/client';
import { readAccountsInSnapshot } from './accounts';
import 'server-only';
import { and, eq, isNull, gte, lt } from 'drizzle-orm';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { AccessError } from '@/server/security/access';
import { category } from '@/server/db/schema/categories';
import { financialAction, ledgerLeg } from '@/server/db/schema/ledger';
import { dateOnly, occurrenceDate } from '@/shared/calendar/calendar';
import { incomeInput } from './income-input';
import { acceptIncome, incomeTotals, type IncomeDto } from '../domain/income';
import {
  incomeCategory,
  saveIncome,
  projectIncome,
} from '../infrastructure/income-repository';
import { financialTransaction, CommandValidation } from './transaction';
export async function createIncome(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<IncomeDto>> {
  const parsed = incomeInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!parsed.success) return validationErrors(parsed.error);
  if (!e.success) return validationErrors(e.error);
  const payload = parsed.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: incomeInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [payload.accountId],
    execute: async ({ tx, actorId, accounts }) => {
      const account = accounts[0];
      if (!account || account.workspaceId !== e.data.workspaceId)
        throw new AccessError();
      let accepted;
      try {
        accepted = acceptIncome(
          account.balanceProjection,
          payload.amount,
          account.currency,
        );
      } catch {
        throw new CommandValidation({
          amount: ['Проверьте точность суммы для валюты счёта'],
        });
      }
      const categoryId = await incomeCategory(
        tx,
        e.data.workspaceId,
        payload.category,
        actorId,
      );
      return {
        reference: await saveIncome(
          tx,
          actorId,
          e.data.workspaceId,
          e.data.operationKey,
          account,
          payload,
          categoryId,
          accepted,
        ),
      };
    },
    project: (tx, id, actorId) =>
      projectIncome(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readIncome(
  headers: Headers,
  workspaceId: string,
  month: string,
) {
  if (!commandEnvelope.shape.workspaceId.safeParse(workspaceId).success)
    throw new AccessError();
  return readWorkspaceSnapshot(headers, workspaceId, ({ tx }) =>
    readIncomeInSnapshot(tx, workspaceId, month),
  );
}
export async function readIncomeAccounts(
  headers: Headers,
  workspaceId: string,
  month: string,
) {
  if (!commandEnvelope.shape.workspaceId.safeParse(workspaceId).success)
    throw new AccessError();
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => ({
      ...(await readAccountsInSnapshot(tx, workspaceId, actorId)),
      income: await readIncomeInSnapshot(tx, workspaceId, month),
      categories: await readCategoriesInSnapshot(tx, workspaceId),
      expenses: await readExpensesInSnapshot(tx, workspaceId, month),
    }),
  );
}
async function readIncomeInSnapshot(
  tx: Transaction,
  workspaceId: string,
  month: string,
) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('INVALID_MONTH');
  const start = dateOnly(`${month}-01`);
  const end = occurrenceDate(start, 1, 'month');

  const categories = await tx
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(
      and(
        eq(category.workspaceId, workspaceId),
        eq(category.kind, 'income'),
        isNull(category.archivedAt),
      ),
    )
    .orderBy(category.name, category.id);
  const legs = await tx
    .select({ amount: ledgerLeg.amount, currency: ledgerLeg.currency })
    .from(ledgerLeg)
    .innerJoin(
      financialAction,
      and(
        eq(financialAction.id, ledgerLeg.actionId),
        eq(financialAction.currentRevision, ledgerLeg.revisionNo),
        eq(financialAction.status, 'active'),
      ),
    )
    .where(
      and(
        eq(ledgerLeg.workspaceId, workspaceId),
        eq(ledgerLeg.role, 'income'),
        gte(ledgerLeg.financialDate, start),
        lt(ledgerLeg.financialDate, end),
      ),
    );
  // Upper bound is exclusive: the first day of the following month belongs there.
  return { categories, totals: incomeTotals(legs) };
}
