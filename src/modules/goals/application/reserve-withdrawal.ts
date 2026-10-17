import 'server-only';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import { executeTransfer } from '@/modules/ledger/application/transfers';
import { executeExpense } from '@/modules/ledger/application/expenses';
import { projectTransfer } from '@/modules/ledger/infrastructure/transfers-repository';
import { projectIncome } from '@/modules/ledger/infrastructure/income-repository';
import { reserveWithdrawalInput } from './reserve-withdrawal-input';
import { guardReserveWithdrawal } from '../infrastructure/reserve-withdrawal-repository';
import { readGoalFundingView } from '../infrastructure/goal-funding-repository';
export async function withdrawReserve(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = reserveWithdrawalInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  if (!e.data.expectedVersion)
    return {
      status: 'validation' as const,
      fieldErrors: { expectedVersion: ['Загрузите актуальный резерв'] },
    };
  const payload = p.data,
    scope = e.data.workspaceId,
    version = e.data.expectedVersion;
  if (payload.kind === 'transfer') {
    if (payload.sourceWorkspaceId !== scope)
      return { status: 'forbidden' as const };
    const schema = reserveWithdrawalInput.options[0];
    return executeTransfer(headers, e.data, payload, schema, {
      beforeWrite: (tx) =>
        guardReserveWithdrawal(
          tx,
          scope,
          payload.goalId,
          payload.sourceAccountId,
          version,
        ),
      project: async (tx, id, actorId) => ({
        ...(await readGoalFundingView(tx, payload.goalId, scope, actorId)),
        transfer: await projectTransfer(tx, id, scope, actorId),
      }),
    });
  }
  return executeExpense(
    headers,
    e.data,
    payload,
    reserveWithdrawalInput.options[1],
    {
      beforeWrite: (tx) =>
        guardReserveWithdrawal(
          tx,
          scope,
          payload.goalId,
          payload.accountId,
          version,
        ),
      project: async (tx, id, actorId) => ({
        ...(await readGoalFundingView(tx, payload.goalId, scope, actorId)),
        expense: await projectIncome(tx, id, scope, actorId, 'expense'),
      }),
    },
  );
}
