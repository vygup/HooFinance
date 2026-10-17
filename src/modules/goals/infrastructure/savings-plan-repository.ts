import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { goal } from '@/server/db/schema/reserve';
import { savingsPlan } from '@/server/db/schema/savings-plan';
import { userProfile } from '@/server/db/schema/identity';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
import { requireWorkspace, AccessError } from '@/server/security/access';
import {
  CommandConflict,
  CommandValidation,
} from '@/modules/ledger/application/transaction';
import { todayInTimezone } from '@/shared/calendar/calendar';
import { validateAmount } from '@/shared/money/decimal';
import {
  savingsProjection,
  type SavingsPlanInput,
  type SavingsPlanDto,
} from '../domain/savings-plan';
import { projectGoal } from './reserve-repository';
async function scopeToday(
  tx: Transaction,
  workspaceId: string,
  actorId: string,
) {
  const scope = await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [profile] = await tx
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, actorId));
  return todayInTimezone(
    scope.kind === 'family' ? scope.timezone! : profile!.timezone,
  );
}
export async function projectSavingsPlan(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
): Promise<SavingsPlanDto> {
  const g = await projectGoal(tx, id, workspaceId, actorId);
  const today = await scopeToday(tx, workspaceId, actorId);
  const [row] = await tx
    .select()
    .from(savingsPlan)
    .where(
      and(eq(savingsPlan.workspaceId, workspaceId), eq(savingsPlan.goalId, id)),
    );
  const anchorDate = row?.anchorDate ?? today;
  const monthlyContribution =
    row?.monthlyContribution == null
      ? null
      : validateAmount(row.monthlyContribution, g.currency);
  return {
    workspaceId,
    goalId: id,
    anchorDate,
    anchorDay: String(row?.anchorDay ?? Number(today.slice(8))),
    monthlyContribution,
    version: row?.version.toString() ?? '0',
    configured: !!row,
    today,
    projection: savingsProjection({
      currency: g.currency,
      remaining: g.progress.remaining,
      status: g.progress.status,
      today,
      targetDate: g.targetDate,
      anchorDate,
      monthlyContribution,
    }),
  };
}
export async function persistSavingsPlan(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: SavingsPlanInput,
  expectedVersion?: string,
) {
  const [g] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.workspaceId, workspaceId), eq(goal.id, input.goalId)))
    .for('update');
  if (!g || g.archivedAt) throw new AccessError();
  const before = await projectSavingsPlan(tx, g.id, workspaceId, actorId);
  if (expectedVersion !== (before.configured ? before.version : undefined))
    throw new CommandConflict();
  if (
    input.anchorDate < before.today &&
    (!before.configured || input.anchorDate !== before.anchorDate)
  )
    throw new CommandValidation({
      anchorDate: ['Дата первого взноса не раньше сегодня'],
    });
  let monthlyContribution: string | null = null;
  try {
    monthlyContribution =
      input.monthlyContribution === undefined
        ? null
        : validateAmount(input.monthlyContribution, g.currency);
  } catch {
    throw new CommandValidation({
      monthlyContribution: ['Проверьте масштаб суммы'],
    });
  }
  const fields = {
    anchorDate: input.anchorDate,
    anchorDay: Number(input.anchorDate.slice(8)),
    monthlyContribution,
    version: BigInt(before.version) + 1n,
  };
  await tx
    .insert(savingsPlan)
    .values({ workspaceId, goalId: g.id, ...fields })
    .onConflictDoUpdate({
      target: [savingsPlan.workspaceId, savingsPlan.goalId],
      set: fields,
    });
  const after = await projectSavingsPlan(tx, g.id, workspaceId, actorId);
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: 'savings_plan',
    objectId: g.id,
    actorId,
    revisionNo: Number(after.version),
    kind: 'configure',
    beforeScope: before,
    afterScope: after,
  });
  return g.id;
}
