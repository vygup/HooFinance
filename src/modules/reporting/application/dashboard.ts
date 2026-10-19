import 'server-only';
import { readObligations } from '@/modules/obligations/application/recurring-payments';
import { paymentTotals } from '@/modules/obligations/domain/overdue';
/** P2 extension of the existing dashboard, using the same authorized payment snapshot. */
export async function readDashboard(
  headers: Headers,
  workspaceId: string,
  from: string,
  until: string,
  instant = new Date(),
) {
  const data = await readObligations(
    headers,
    workspaceId,
    from,
    until,
    instant,
  );
  const selected = data.payments.filter(
    (p) => p.scheduledDate >= from && p.scheduledDate <= until,
  );
  return {
    workspaceId,
    from,
    until,
    today: data.today,
    payments: data.payments
      .filter((p) => p.status === 'planned')
      .map((p) => ({
        id: p.id,
        name: p.name,
        scheduledDate: p.scheduledDate,
        scheduledAmount: p.scheduledAmount,
        currency: p.currency,
        overdue: p.overdue,
      })),
    plan: paymentTotals(selected),
    fact: paymentTotals(
      selected
        .filter((p) => p.status === 'paid' && p.actualAmount !== null)
        .map((p) => ({
          currency: p.currency,
          scheduledAmount: p.actualAmount!,
        })),
    ),
    unpaid: data.totals,
    overdue: paymentTotals(data.payments.filter((p) => p.overdue)),
  };
}

import { eq } from 'drizzle-orm';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { userProfile } from '@/server/db/schema/identity';
import { requireWorkspace } from '@/server/security/access';
import { occurrenceDate, reportPeriod } from '@/shared/calendar/calendar';
import { calendarContext } from '@/modules/workspaces/domain/switching';
import { dashboardInput } from './dashboard-input';
import {
  dashboardSnapshot,
  dashboardPayments,
} from '../infrastructure/dashboard-repository';
/** All dashboard cards share one authorized repeatable-read, read-only transaction. */
export async function readWorkspaceDashboard(
  headers: Headers,
  input: unknown,
  instant = new Date(),
) {
  const selection = dashboardInput.parse(input);
  return readWorkspaceSnapshot(
    headers,
    selection.workspaceId,
    async ({ tx, actorId }) => {
      const scope = await requireWorkspace(
        actorId,
        selection.workspaceId,
        'read',
        tx,
      );
      const [profile] = await tx
        .select({ timezone: userProfile.timezone })
        .from(userProfile)
        .where(eq(userProfile.userId, actorId));
      const context = calendarContext(
        scope.kind as 'personal' | 'family',
        scope.timezone,
        profile!.timezone,
        instant,
      );
      const period = reportPeriod('current', context.today);
      const from = selection.from ?? context.today;
      const until = selection.until ?? occurrenceDate(from, 1, 'month');
      return {
        workspaceId: selection.workspaceId,
        ...context,
        monthFrom: period.from,
        monthUntil: period.until,
        ...(await dashboardSnapshot(
          tx,
          selection.workspaceId,
          actorId,
          period.from,
          period.until,
        )),
        upcoming: await dashboardPayments(
          tx,
          selection.workspaceId,
          actorId,
          from,
          until,
          context.today,
        ),
      };
    },
  );
}
export type DashboardReport = Awaited<
  ReturnType<typeof readWorkspaceDashboard>
>;
