import 'server-only';
import { and, eq, gt, ne } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import {
  obligation,
  obligationOccurrence,
} from '@/server/db/schema/recurring-payments';
import { obligationScheduleRevision } from '@/server/db/schema/obligation-schedule';
import { workspace } from '@/server/db/schema/workspaces';
import { userProfile } from '@/server/db/schema/identity';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import { goal, reserveSettings } from '@/server/db/schema/reserve';
import {
  scopedAuditEvent,
  financialAction,
  ledgerLeg,
} from '@/server/db/schema/ledger';
import { AccessError, requireWorkspace } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import { projectGoal } from '@/modules/goals/infrastructure/reserve-repository';
import { validateAmount } from '@/shared/money/decimal';
import { todayInTimezone, followingDate } from '@/shared/calendar/calendar';
import { canLinkReserve } from '../domain/overdue';
import { materializePayments } from './schedule-history-repository';
import type { RecurringPaymentInput } from '../application/recurring-payments-input';
export async function workspaceToday(
  tx: Transaction,
  workspaceId: string,
  instant = new Date(),
) {
  const [w] = await tx
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!w) throw new AccessError();
  const [profile] = w.personalOwnerId
    ? await tx
        .select()
        .from(userProfile)
        .where(eq(userProfile.userId, w.personalOwnerId))
    : [];
  return todayInTimezone(
    w.kind === 'family' ? w.timezone! : profile!.timezone,
    instant,
  );
}
export function obligationDto(row: typeof obligation.$inferSelect) {
  return {
    ...row,
    amount: validateAmount(row.amount, row.currency),
    version: row.version.toString(),
  };
}
export async function projectObligation(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
) {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select()
    .from(obligation)
    .where(and(eq(obligation.id, id), eq(obligation.workspaceId, workspaceId)));
  if (!row) throw new AccessError();
  return obligationDto(row);
}
export async function projectPayment(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
) {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select()
    .from(obligationOccurrence)
    .where(
      and(
        eq(obligationOccurrence.id, id),
        eq(obligationOccurrence.workspaceId, workspaceId),
      ),
    );
  if (!row) throw new AccessError();
  const [leg] = row.paymentActionId
    ? await tx
        .select({ leg: ledgerLeg })
        .from(ledgerLeg)
        .innerJoin(
          financialAction,
          and(
            eq(financialAction.id, ledgerLeg.actionId),
            eq(financialAction.currentRevision, ledgerLeg.revisionNo),
            eq(financialAction.status, 'active'),
          ),
        )
        .where(
          and(
            eq(ledgerLeg.actionId, row.paymentActionId),
            eq(ledgerLeg.workspaceId, workspaceId),
            eq(ledgerLeg.role, 'expense'),
          ),
        )
    : [];
  return {
    ...row,
    scheduledAmount: validateAmount(row.scheduledAmount, row.currency),
    actualAmount: leg ? validateAmount(leg.leg.amount, leg.leg.currency) : null,
    actualDate: leg?.leg.financialDate ?? null,
    actualAccountId: leg?.leg.accountId ?? null,
  };
}
export async function persistObligation(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: Exclude<RecurringPaymentInput, { command: 'linkReserve' }>,
  expectedVersion?: string,
) {
  const today = await workspaceToday(tx, workspaceId);
  let before: ReturnType<typeof obligationDto> | null = null;
  if (input.command !== 'create') {
    const [row] = await tx
      .select()
      .from(obligation)
      .where(
        and(
          eq(obligation.id, input.id),
          eq(obligation.workspaceId, workspaceId),
        ),
      )
      .for('update');
    if (!row || row.status === 'archived') throw new AccessError();
    if (row.version.toString() !== expectedVersion) throw new CommandConflict();
    before = obligationDto(row);
    await materializePayments(tx, workspaceId, row.id, today, today, today);
  } else if (expectedVersion !== undefined) throw new CommandConflict();
  if (input.command === 'create' || input.command === 'update') {
    if (before && before.currency !== input.currency)
      throw new CommandConflict();
    const [a] = await tx
      .select()
      .from(financialAccount)
      .where(
        and(
          eq(financialAccount.id, input.accountId),
          eq(financialAccount.workspaceId, workspaceId),
        ),
      );
    const [c] = await tx
      .select()
      .from(category)
      .where(
        and(
          eq(category.id, input.categoryId),
          eq(category.workspaceId, workspaceId),
        ),
      );
    if (
      !a ||
      a.archivedAt ||
      a.currency !== input.currency ||
      !c ||
      c.archivedAt ||
      c.kind !== 'expense'
    )
      throw new AccessError();
  }
  const links = before
    ? await tx
        .select({ settings: reserveSettings })
        .from(reserveSettings)
        .where(
          and(
            eq(reserveSettings.workspaceId, workspaceId),
            eq(reserveSettings.linkedObligationId, before.id),
          ),
        )
    : [];
  if (links.length && input.command === 'update' && !canLinkReserve(input))
    throw new CommandConflict();
  const reserveBefore = [];
  for (const link of links)
    reserveBefore.push(
      await projectGoal(tx, link.settings.goalId, workspaceId, actorId),
    );
  const fields =
    input.command === 'create' || input.command === 'update'
      ? {
          name: input.name,
          amount: validateAmount(input.amount, input.currency),
          currency: input.currency,
          repeatEvery: input.repeatEvery,
          repeatUnit: input.repeatUnit,
          anchorDate: input.anchorDate,
          anchorDay: new Date(`${input.anchorDate}T00:00:00Z`).getUTCDate(),
          categoryId: input.categoryId,
          accountId: input.accountId,
        }
      : {};
  let row: typeof obligation.$inferSelect;
  if (input.command === 'create') {
    [row] = (await tx
      .insert(obligation)
      .values({
        ...fields,
        workspaceId,
        status: 'active',
      } as typeof obligation.$inferInsert)
      .returning()) as [typeof obligation.$inferSelect];
  } else {
    const status =
      input.command === 'pause'
        ? 'paused'
        : input.command === 'resume'
          ? 'active'
          : input.command === 'archive'
            ? 'archived'
            : before!.status;
    [row] = (await tx
      .update(obligation)
      .set({ ...fields, status, version: BigInt(before!.version) + 1n })
      .where(
        and(
          eq(obligation.workspaceId, workspaceId),
          eq(obligation.id, input.id),
        ),
      )
      .returning()) as [typeof obligation.$inferSelect];
    await tx
      .update(obligationOccurrence)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(obligationOccurrence.workspaceId, workspaceId),
          eq(obligationOccurrence.obligationId, row.id),
          eq(obligationOccurrence.status, 'planned'),
          gt(obligationOccurrence.scheduledDate, today),
        ),
      );
  }
  await tx
    .insert(obligationScheduleRevision)
    .values({
      workspaceId,
      obligationId: row.id,
      revisionNo: Number(row.version),
      anchorDate: row.anchorDate,
      anchorDay: row.anchorDay,
      repeatEvery: row.repeatEvery,
      repeatUnit: row.repeatUnit,
      amount: row.amount,
      currency: row.currency,
      activeFrom:
        input.command === 'create' ? row.anchorDate : followingDate(today),
      status: row.status,
    });
  for (const old of reserveBefore) {
    await tx
      .update(goal)
      .set({ version: BigInt(old.version) + 1n })
      .where(and(eq(goal.id, old.id), eq(goal.workspaceId, workspaceId)));
    await tx
      .insert(scopedAuditEvent)
      .values({
        workspaceId,
        objectType: 'goal',
        objectId: old.id,
        actorId,
        revisionNo: Number(BigInt(old.version) + 1n),
        kind: 'obligation_changed',
        beforeScope: old,
        afterScope: await projectGoal(tx, old.id, workspaceId, actorId),
      });
  }
  await tx
    .insert(scopedAuditEvent)
    .values({
      workspaceId,
      objectType: 'obligation',
      objectId: row.id,
      actorId,
      revisionNo: Number(row.version),
      kind: input.command,
      beforeScope: before,
      afterScope: obligationDto(row),
    });
  return row.id;
}
export async function linkReserve(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: Extract<RecurringPaymentInput, { command: 'linkReserve' }>,
  expectedVersion?: string,
) {
  const [g] = await tx
    .select()
    .from(goal)
    .where(and(eq(goal.id, input.goalId), eq(goal.workspaceId, workspaceId)))
    .for('update');
  if (!g || g.type !== 'reserve' || g.archivedAt) throw new AccessError();
  if (g.version.toString() !== expectedVersion) throw new CommandConflict();
  const before = await projectGoal(tx, g.id, workspaceId, actorId);
  if (input.obligationId) {
    const [o] = await tx
      .select()
      .from(obligation)
      .where(
        and(
          eq(obligation.id, input.obligationId),
          eq(obligation.workspaceId, workspaceId),
        ),
      )
      .for('update');
    if (!o || o.currency !== g.currency || !canLinkReserve(o))
      throw new AccessError();
  }
  await tx
    .update(reserveSettings)
    .set({
      linkedObligationId: input.obligationId,
      monthlyAmount: before.monthlyAmount!,
    })
    .where(
      and(
        eq(reserveSettings.goalId, g.id),
        eq(reserveSettings.workspaceId, workspaceId),
      ),
    );
  await tx
    .update(goal)
    .set({ version: g.version + 1n })
    .where(and(eq(goal.id, g.id), eq(goal.workspaceId, workspaceId)));
  await tx
    .insert(scopedAuditEvent)
    .values({
      workspaceId,
      objectType: 'goal',
      objectId: g.id,
      actorId,
      revisionNo: Number(g.version + 1n),
      kind: 'link_obligation',
      beforeScope: before,
      afterScope: await projectGoal(tx, g.id, workspaceId, actorId),
    });
  return g.id;
}
export async function paymentRows(tx: Transaction, workspaceId: string) {
  return tx
    .select()
    .from(obligationOccurrence)
    .where(
      and(
        eq(obligationOccurrence.workspaceId, workspaceId),
        ne(obligationOccurrence.status, 'superseded'),
      ),
    )
    .orderBy(obligationOccurrence.scheduledDate, obligationOccurrence.id);
}
