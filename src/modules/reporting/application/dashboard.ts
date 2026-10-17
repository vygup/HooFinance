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
