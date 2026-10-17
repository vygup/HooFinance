import Link from 'next/link';
import type { readDashboard } from '../application/dashboard';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
export function UpcomingPayments({
  data,
  locale = 'ru-RU',
}: {
  data: Awaited<ReturnType<typeof readDashboard>>;
  locale?: string;
}) {
  return (
    <section
      aria-label="Предстоящие платежи"
      className="grid gap-3 rounded-lg border p-5"
    >
      <h2 className="text-xl font-medium">Предстоящие платежи и просрочка</h2>
      <p>
        {formatFinancialDate(data.from, locale)} —{' '}
        {formatFinancialDate(data.until, locale)}
      </p>
      <p>
        План не списывает деньги. Факт — подтверждённые оплаты экземпляров
        выбранного интервала.
      </p>
      {data.plan.map((t) => (
        <p key={t.currency}>
          План за интервал: {formatMoney(t.amount, t.currency, locale)}
        </p>
      ))}
      {data.fact.map((t) => (
        <p key={t.currency}>
          Факт выбранных платежей: {formatMoney(t.amount, t.currency, locale)}
        </p>
      ))}
      {data.overdue.map((t) => (
        <p key={t.currency}>
          Просрочено: {formatMoney(t.amount, t.currency, locale)}
        </p>
      ))}
      {data.unpaid.map((t) => (
        <p key={t.currency}>
          К оплате с просрочкой: {formatMoney(t.amount, t.currency, locale)}
        </p>
      ))}
      {data.payments.length === 0 ? (
        <p>Неоплаченных платежей нет.</p>
      ) : (
        <>
          <p>Первые пять неоплаченных платежей по дате:</p>
          <ul className="grid gap-2">
            {data.payments.slice(0, 5).map((p) => (
              <li key={p.id} className="break-words">
                {p.name} · {formatFinancialDate(p.scheduledDate, locale)} ·{' '}
                {formatMoney(p.scheduledAmount, p.currency, locale)} ·{' '}
                {p.overdue ? 'Просрочено' : 'Предстоящий платёж'}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link
        className="underline"
        href={`/w/${data.workspaceId}/obligations?from=${data.from}&until=${data.until}`}
      >
        Все платежи и подтверждение оплаты
      </Link>
    </section>
  );
}
