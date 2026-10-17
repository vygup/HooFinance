import 'server-only';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { executeTransfer } from '@/modules/ledger/application/transfers';
import { projectTransfer } from '@/modules/ledger/infrastructure/transfers-repository';
import { goalFundingInput, goalFundingSelection } from './goal-funding-input';
import {
  guardGoalFunding,
  readGoalFundingView,
} from '../infrastructure/goal-funding-repository';
import type { GoalFundingResult } from '../domain/goal-funding';
export async function fundGoal(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<GoalFundingResult>> {
  const p = goalFundingInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  if (!e.data.expectedVersion)
    return {
      status: 'validation',
      fieldErrors: { expectedVersion: ['Загрузите актуальную цель'] },
    };
  return executeTransfer(headers, e.data, p.data, goalFundingInput, {
    beforeWrite: (tx) =>
      guardGoalFunding(tx, e.data.workspaceId, p.data, e.data.expectedVersion!),
    project: async (tx, id, actorId) => ({
      ...(await readGoalFundingView(
        tx,
        p.data.goalId,
        e.data.workspaceId,
        actorId,
      )),
      transfer: await projectTransfer(tx, id, e.data.workspaceId, actorId),
    }),
  });
}
export async function readGoalFunding(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  const selection = goalFundingSelection.parse(input),
    scope = commandEnvelope.shape.workspaceId.parse(workspaceId);
  return readWorkspaceSnapshot(headers, scope, ({ tx, actorId }) =>
    readGoalFundingView(tx, selection.goalId, scope, actorId),
  );
}
