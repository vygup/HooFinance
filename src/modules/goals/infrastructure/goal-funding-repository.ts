import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { goal } from '@/server/db/schema/reserve';
import { AccessError } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import { projectGoal } from './reserve-repository';
import { projectSavingsAccount } from './savings-account-repository';
import type { GoalFundingInput, GoalFundingView } from '../domain/goal-funding';
export async function guardGoalFunding(
  tx: Transaction,
  workspaceId: string,
  input: GoalFundingInput,
  expectedVersion: string,
) {
  const [row] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.workspaceId, workspaceId), eq(goal.id, input.goalId)))
    .for('update');
  if (
    !row ||
    row.archivedAt ||
    row.accountId !== input.destinationAccountId ||
    input.destinationWorkspaceId !== workspaceId
  )
    throw new AccessError();
  if (row.version.toString() !== expectedVersion) throw new CommandConflict();
}
export async function readGoalFundingView(
  tx: Transaction,
  goalId: string,
  workspaceId: string,
  actorId: string,
): Promise<GoalFundingView> {
  const target = await projectGoal(tx, goalId, workspaceId, actorId);
  return {
    goal: target,
    account: await projectSavingsAccount(
      tx,
      target.accountId,
      workspaceId,
      actorId,
    ),
  };
}
