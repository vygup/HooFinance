import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { goal } from '@/server/db/schema/reserve';
import { AccessError } from '@/server/security/access';
import {
  CommandConflict,
  CommandValidation,
} from '@/modules/ledger/application/transaction';
import {
  adjustedReserveProgress,
  type ReserveAdjustmentInput,
} from '../domain/reserve-adjustment';
import { persistGoal, projectGoal } from './reserve-repository';
export async function persistReserveAdjustment(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: ReserveAdjustmentInput,
  expectedVersion?: string,
) {
  const [row] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.id, input.goalId), eq(goal.workspaceId, workspaceId)))
    .for('update');
  if (!row || row.archivedAt || row.type !== 'reserve') throw new AccessError();
  if (row.version.toString() !== expectedVersion) throw new CommandConflict();
  const before = await projectGoal(tx, row.id, workspaceId, actorId);
  // Validate against the stored currency; the client cannot replace the account or currency.
  try {
    adjustedReserveProgress(row.currency, before.progress.actual, input);
  } catch {
    throw new CommandValidation({ monthlyAmount: ['Проверьте масштаб суммы'] });
  }
  return persistGoal(
    tx,
    actorId,
    workspaceId,
    {
      command: 'update',
      id: row.id,
      type: 'reserve',
      name: row.name,
      description: row.description ?? undefined,
      accountId: row.accountId,
      currency: row.currency,
      targetDate: row.targetDate ?? undefined,
      monthlyAmount: input.monthlyAmount,
      coverageMonths: input.coverageMonths,
    },
    expectedVersion,
  );
}
