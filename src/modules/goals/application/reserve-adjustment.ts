import 'server-only';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import { reserveAdjustmentInput } from './reserve-adjustment-input';
import { persistReserveAdjustment } from '../infrastructure/reserve-adjustment-repository';
import { projectGoal } from '../infrastructure/reserve-repository';
export async function adjustReserve(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = reserveAdjustmentInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return financialTransaction({
    headers,
    envelope: e.data,
    payload: p.data,
    payloadSchema: reserveAdjustmentInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [],
    execute: async ({ tx, actorId }) => ({
      reference: await persistReserveAdjustment(
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
