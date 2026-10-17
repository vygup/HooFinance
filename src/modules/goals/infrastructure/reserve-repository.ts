import { savingsPlan } from '@/server/db/schema/savings-plan';
import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { goal, reserveSettings } from '@/server/db/schema/reserve';
import { financialAccount } from '@/server/db/schema/accounts';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import { validateAmount } from '@/shared/money/decimal';
import { goalProgress, type GoalInput, type GoalDto } from '../domain/reserve';
export async function projectGoal(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
): Promise<GoalDto> {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.id, id), eq(goal.workspaceId, workspaceId)));
  if (!row) throw new AccessError();
  const [account] = await tx
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, row.accountId),
        eq(financialAccount.workspaceId, workspaceId),
      ),
    );
  if (!account) throw new AccessError();
  const [settings] = await tx
    .select()
    .from(reserveSettings)
    .where(
      and(
        eq(reserveSettings.workspaceId, workspaceId),
        eq(reserveSettings.goalId, id),
      ),
    );
  if (row.type === 'reserve' && !settings)
    throw Error('INVALID_RESERVE_SETTINGS');
  const type = row.type as 'ordinary' | 'reserve';
  const monthlyAmount = settings
    ? validateAmount(settings.monthlyAmount, row.currency)
    : null;
  const coverageMonths = settings?.coverageMonths ?? null;
  const ordinaryTarget =
    row.ordinaryTarget === null
      ? null
      : validateAmount(row.ordinaryTarget, row.currency);
  return {
    id,
    workspaceId,
    name: row.name,
    description: row.description ?? '',
    type,
    currency: row.currency,
    accountId: account.id,
    accountName: account.name,
    ordinaryTarget,
    targetDate: row.targetDate,
    monthlyAmount,
    coverageMonths,
    archived: !!row.archivedAt,
    version: row.version.toString(),
    progress: goalProgress(
      row.currency,
      account.balanceProjection,
      type === 'reserve'
        ? {
            type,
            monthlyAmount: monthlyAmount!,
            coverageMonths: coverageMonths!,
          }
        : { type, ordinaryTarget: ordinaryTarget! },
    ),
  };
}
export async function persistGoal(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: GoalInput,
  expectedVersion?: string,
) {
  let before: GoalDto | null = null;
  if (input.command !== 'create') {
    const [old] = await tx
      .select()
      .from(goal)
      .where(and(eq(goal.id, input.id), eq(goal.workspaceId, workspaceId)))
      .for('update');
    if (!old || old.archivedAt) throw new AccessError();
    if (old.version.toString() !== expectedVersion) throw new CommandConflict();
    before = await projectGoal(tx, old.id, workspaceId, actorId);
  } else if (expectedVersion !== undefined) throw new CommandConflict();
  if (input.command === 'update' && before!.currency !== input.currency) {
    const [plan] = await tx
      .select({ goalId: savingsPlan.goalId })
      .from(savingsPlan)
      .where(
        and(
          eq(savingsPlan.workspaceId, workspaceId),
          eq(savingsPlan.goalId, input.id),
        ),
      );
    // A saved contribution cannot silently acquire a different currency.
    if (plan) throw new CommandConflict();
  }
  if (input.command !== 'archive') {
    const [account] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, input.accountId),
          eq(financialAccount.workspaceId, workspaceId),
        ),
      );
    if (
      !account ||
      account.currency !== input.currency ||
      (account.archivedAt && before?.accountId !== account.id)
    )
      throw new AccessError();
    const occupied = await tx
      .select({ id: goal.id })
      .from(goal)
      .where(
        and(
          eq(goal.workspaceId, workspaceId),
          eq(goal.accountId, input.accountId),
          isNull(goal.archivedAt),
          before ? ne(goal.id, before.id) : undefined,
        ),
      );
    if (occupied.length) throw new CommandConflict();
  }
  let id: string;
  if (input.command === 'archive') {
    id = input.id;
    await tx
      .update(goal)
      .set({ archivedAt: new Date(), version: BigInt(before!.version) + 1n })
      .where(and(eq(goal.id, id), eq(goal.workspaceId, workspaceId)));
  } else {
    const fields = {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      currency: input.currency,
      accountId: input.accountId,
      ordinaryTarget: input.type === 'ordinary' ? input.ordinaryTarget : null,
      targetDate: input.targetDate ?? null,
    };
    if (input.command === 'create') {
      const [row] = await tx
        .insert(goal)
        .values({ ...fields, workspaceId })
        .returning();
      id = row!.id;
    } else {
      id = input.id;
      await tx
        .update(goal)
        .set({ ...fields, version: BigInt(before!.version) + 1n })
        .where(and(eq(goal.id, id), eq(goal.workspaceId, workspaceId)));
    }
    await tx
      .delete(reserveSettings)
      .where(
        and(
          eq(reserveSettings.workspaceId, workspaceId),
          eq(reserveSettings.goalId, id),
        ),
      );
    if (input.type === 'reserve')
      await tx.insert(reserveSettings).values({
        workspaceId,
        goalId: id,
        monthlyAmount: input.monthlyAmount,
        coverageMonths: input.coverageMonths,
      });
  }
  const after = await projectGoal(tx, id, workspaceId, actorId);
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: 'goal',
    objectId: id,
    actorId,
    revisionNo: Number(after.version),
    kind: input.command,
    beforeScope: before,
    afterScope: after,
  });
  return id;
}
