import { projectSavingsPlan } from '../infrastructure/savings-plan-repository';
import { readCategoriesInSnapshot } from '@/modules/categories/application/expenses';
import 'server-only';
import { eq } from 'drizzle-orm';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { goal } from '@/server/db/schema/reserve';
import { readGoalAccountOptions } from '../infrastructure/savings-account-repository';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import { goalInput } from './reserve-input';
import type { GoalFundingView } from '../domain/goal-funding';
import { readGoalFundingView } from '../infrastructure/goal-funding-repository';
import { persistGoal, projectGoal } from '../infrastructure/reserve-repository';
export async function goalCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = goalInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return financialTransaction({
    headers,
    envelope: e.data,
    payload: p.data,
    payloadSchema: goalInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: p.data.command === 'archive' ? [] : [p.data.accountId],
    allowArchivedAccounts: true,
    execute: async ({ tx, actorId }) => ({
      reference: await persistGoal(
        tx,
        actorId,
        e.data.workspaceId,
        p.data,
        e.data.expectedVersion,
      ),
    }),
    project: (tx, id, actorId) =>
      projectGoal(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readGoals(headers: Headers, workspaceId: string) {
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => {
      const rows = await tx
        .select({ id: goal.id })
        .from(goal)
        .where(eq(goal.workspaceId, workspaceId))
        .orderBy(goal.name, goal.id);
      const funding: GoalFundingView[] = [];
      for (const row of rows)
        funding.push(
          await readGoalFundingView(tx, row.id, workspaceId, actorId),
        );
      const goals = funding.map((v) => v.goal);
      const accounts = await readGoalAccountOptions(
        tx,
        workspaceId,
        goals.filter((g) => !g.archived).map((g) => g.accountId),
      );
      const savings = [];
      for (const g of goals)
        savings.push(await projectSavingsPlan(tx, g.id, workspaceId, actorId));
      return {
        savings,
        goals,
        accounts,
        funding,
        expenseCategories: (
          await readCategoriesInSnapshot(tx, workspaceId)
        ).filter((c) => c.kind === 'expense' && !c.archived),
      };
    },
  );
}
