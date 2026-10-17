import 'server-only';
import type { Transaction } from '@/server/db/client';
import { and, eq, gte, lt } from 'drizzle-orm';
import { category } from '@/server/db/schema/categories';
import { ledgerLeg, financialAction } from '@/server/db/schema/ledger';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import { incomeTotals } from '@/modules/ledger/domain/income';
import { dateOnly, occurrenceDate } from '@/shared/calendar/calendar';
import { categoryInput, type CategoryDto } from '../domain/expenses';
import {
  saveCategory,
  projectCategory,
  categoryDto,
} from '../infrastructure/expenses-repository';
export async function categoryCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<CategoryDto>> {
  const p = categoryInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return financialTransaction({
    headers,
    envelope: e.data,
    payload: p.data,
    payloadSchema: categoryInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [],
    execute: async ({ tx, actorId }) => ({
      reference: await saveCategory(
        tx,
        actorId,
        e.data.workspaceId,
        p.data,
        e.data.expectedVersion,
      ),
    }),
    project: (tx, id, actorId) =>
      projectCategory(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readCategoriesInSnapshot(
  tx: Transaction,
  workspaceId: string,
) {
  return (
    await tx
      .select()
      .from(category)
      .where(eq(category.workspaceId, workspaceId))
      .orderBy(category.name, category.id)
  ).map(categoryDto);
}
export async function readCategories(headers: Headers, workspaceId: string) {
  return readWorkspaceSnapshot(headers, workspaceId, ({ tx }) =>
    readCategoriesInSnapshot(tx, workspaceId),
  );
}
export async function readExpenses(
  headers: Headers,
  workspaceId: string,
  month: string,
) {
  return readWorkspaceSnapshot(headers, workspaceId, ({ tx }) =>
    readExpensesInSnapshot(tx, workspaceId, month),
  );
}
export async function readExpensesInSnapshot(
  tx: Transaction,
  workspaceId: string,
  month: string,
) {
  const start = dateOnly(`${month}-01`),
    end = occurrenceDate(start, 1, 'month');
  const legs = await tx
    .select({
      amount: ledgerLeg.amount,
      currency: ledgerLeg.currency,
      categoryId: ledgerLeg.categoryId,
    })
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
        eq(ledgerLeg.role, 'expense'),
        gte(ledgerLeg.financialDate, start),
        lt(ledgerLeg.financialDate, end),
      ),
    );
  return {
    totals: incomeTotals(legs),
    byCategory: [...new Set(legs.map((l) => l.categoryId))].map(
      (categoryId) => ({
        categoryId,
        totals: incomeTotals(legs.filter((l) => l.categoryId === categoryId)),
      }),
    ),
  };
}
