import 'server-only';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import {
  readCategoriesInSnapshot,
  readExpensesInSnapshot,
} from '@/modules/categories/application/expenses';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import {
  budgetInput,
  budgetMonth,
  budgetCurrency,
  calculateBudget,
} from '../domain/monthly-budget';
import {
  persistBudget,
  projectBudget,
  findBudget,
} from '../infrastructure/monthly-budget-repository';
export async function saveMonthlyBudget(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = budgetInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return financialTransaction({
    headers,
    envelope: e.data,
    payload: p.data,
    payloadSchema: budgetInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [],
    execute: async ({ tx, actorId }) => ({
      reference: await persistBudget(
        tx,
        actorId,
        e.data.workspaceId,
        p.data,
        e.data.expectedVersion,
      ),
    }),
    project: (tx, ref, actorId) =>
      projectBudget(tx, ref, e.data.workspaceId, actorId),
  });
}
export async function readMonthlyBudget(
  headers: Headers,
  workspaceId: string,
  month: string,
  currency: string,
) {
  budgetMonth.parse(month);
  budgetCurrency.parse(currency);
  return readWorkspaceSnapshot(headers, workspaceId, async ({ tx }) => {
    const budget = await findBudget(tx, workspaceId, month, currency);
    const categories = await readCategoriesInSnapshot(tx, workspaceId);
    const expenses = await readExpensesInSnapshot(tx, workspaceId, month);
    const rows = expenses.byCategory.flatMap((c) =>
      c.totals.map((t) => ({ ...t, categoryId: c.categoryId })),
    );
    return {
      budget,
      categories: categories.filter((c) => c.kind === 'expense'),
      summary: calculateBudget(
        currency,
        budget?.plannedIncome ?? '0',
        budget?.categoryLimits ?? [],
        rows,
      ),
    };
  });
}
