import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { obligationScheduleRevision } from '@/server/db/schema/obligation-schedule';
import { obligationOccurrence } from '@/server/db/schema/recurring-payments';
import {
  schedulePayments,
  type ScheduleRevision,
  type SavedPayment,
} from '../domain/overdue';
export async function scheduleHistory(
  tx: Transaction,
  workspaceId: string,
  obligationId: string,
) {
  const history = await tx
    .select()
    .from(obligationScheduleRevision)
    .where(
      and(
        eq(obligationScheduleRevision.workspaceId, workspaceId),
        eq(obligationScheduleRevision.obligationId, obligationId),
      ),
    )
    .orderBy(obligationScheduleRevision.revisionNo);
  const saved = await tx
    .select()
    .from(obligationOccurrence)
    .where(
      and(
        eq(obligationOccurrence.workspaceId, workspaceId),
        eq(obligationOccurrence.obligationId, obligationId),
      ),
    );
  return {
    history: history as ScheduleRevision[],
    saved: saved as SavedPayment[],
  };
}
/** Called only inside the authorized workspace/obligation write lock. */
export async function materializePayments(
  tx: Transaction,
  workspaceId: string,
  obligationId: string,
  from: string,
  until: string,
  today: string,
) {
  const { history, saved } = await scheduleHistory(
    tx,
    workspaceId,
    obligationId,
  );
  for (const p of schedulePayments(history, saved, from, until, today)) {
    await tx
      .insert(obligationOccurrence)
      .values({
        workspaceId,
        obligationId,
        scheduledDate: p.scheduledDate,
        scheduledAmount: p.scheduledAmount,
        currency: p.currency,
        sourceVersion: p.sourceVersion,
        status: 'planned',
      })
      .onConflictDoNothing();
  }
}
