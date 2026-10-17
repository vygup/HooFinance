import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { goal } from '@/server/db/schema/reserve';
import { AccessError } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
export async function guardReserveWithdrawal(
  tx: Transaction,
  workspaceId: string,
  goalId: string,
  accountId: string,
  expectedVersion: string,
) {
  const [row] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.workspaceId, workspaceId), eq(goal.id, goalId)))
    .for('update');
  if (
    !row ||
    row.archivedAt ||
    row.type !== 'reserve' ||
    row.accountId !== accountId
  )
    throw new AccessError();
  if (row.version.toString() !== expectedVersion) throw new CommandConflict();
}
