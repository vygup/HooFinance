import { dateOnly, recurrenceDates } from '@/shared/calendar/calendar';
import { validateAmount, addMoney } from '@/shared/money/decimal';
export type ScheduleRevision = {
  anchorDate: string;
  repeatEvery: Parameters<typeof recurrenceDates>[1];
  repeatUnit: Parameters<typeof recurrenceDates>[2];
  amount: string;
  currency: string;
  revisionNo: Parameters<typeof recurrenceDates>[1];
  activeFrom: string;
  activeUntil: string | null;
  status: 'active' | 'paused' | 'archived';
};
export type ScheduledPayment = {
  scheduledDate: string;
  scheduledAmount: string;
  currency: string;
  sourceVersion: ScheduleRevision['revisionNo'];
  overdue: boolean;
};
export type SavedPayment = Omit<ScheduledPayment, 'overdue'> & {
  status: 'planned' | 'paid' | 'superseded';
};
export function schedulePayments(
  history: readonly ScheduleRevision[],
  saved: readonly SavedPayment[],
  from: string,
  until: string,
  today: string,
): ScheduledPayment[] {
  dateOnly(from);
  dateOnly(until);
  dateOnly(today);
  const revisions = [...history].sort((a, b) =>
    a.revisionNo > b.revisionNo ? 1 : -1,
  );
  const payments = new Map<string, ScheduledPayment>();
  const visible = (date: string) =>
    date <= today || (date >= from && date <= until);
  for (const rev of revisions) {
    if (rev.status !== 'active') continue;
    const next = revisions.find((r) => r.revisionNo > rev.revisionNo);
    const end = until > today ? until : today;
    for (const date of recurrenceDates(
      rev.anchorDate,
      rev.repeatEvery,
      rev.repeatUnit,
      rev.activeFrom,
      end,
    )) {
      if (
        (next && date >= next.activeFrom) ||
        (rev.activeUntil && date > rev.activeUntil) ||
        !visible(date)
      )
        continue;
      const excluded = saved.some(
        (p) =>
          p.scheduledDate === date &&
          (p.status === 'paid' ||
            (p.status === 'superseded' && p.sourceVersion === rev.revisionNo)),
      );
      if (!excluded)
        payments.set(date, {
          scheduledDate: date,
          scheduledAmount: validateAmount(rev.amount, rev.currency),
          currency: rev.currency,
          sourceVersion: rev.revisionNo,
          overdue: date < today,
        });
    }
  }
  for (const p of saved)
    if (
      p.status === 'planned' &&
      visible(p.scheduledDate) &&
      p.scheduledDate <= today
    )
      payments.set(p.scheduledDate, {
        ...p,
        scheduledAmount: validateAmount(p.scheduledAmount, p.currency),
        overdue: p.scheduledDate < today,
      });
  return [...payments.values()].sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate),
  );
}
export function paymentTotals(
  payments: readonly Pick<ScheduledPayment, 'currency' | 'scheduledAmount'>[],
) {
  const totals = new Map<string, string>();
  for (const p of payments)
    totals.set(
      p.currency,
      addMoney([totals.get(p.currency) ?? '0', p.scheduledAmount], p.currency),
    );
  return [...totals]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
export function canLinkReserve(
  schedule: Pick<ScheduleRevision, 'repeatUnit' | 'repeatEvery'>,
) {
  return schedule.repeatUnit === 'month' && schedule.repeatEvery === 1;
}
