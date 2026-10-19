'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import type { DashboardReport } from '../application/dashboard';
import { dashboardInput } from '../domain/dashboard-input';
import { dashboardAction } from './dashboard-actions';
import { UpcomingPayments } from './upcoming-payments';
type Goal = DashboardReport['goals'][number];
export function DashboardView({
  initial,
  locale,
  interval,
}: {
  initial: DashboardReport;
  locale: string;
  interval?: { from: string; until: string };
}) {
  const [report, setReport] = useState<DashboardReport | null>(initial);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({ defaultValues: { workspaceId: initial.workspaceId } });
  const base = `/w/${initial.workspaceId}`;
  const money = (amount: string, currency: string) =>
    formatMoney(amount, currency, locale);
  return (
    <>
      <form
        aria-label="Обновление обзора"
        data-navigation-form
        className="flex flex-wrap items-center gap-3"
        onSubmit={handleSubmit(async (values) => {
          setMessage('');
          setFailed(false);
          const parsed = dashboardInput.safeParse({ ...values, ...interval });
          try {
            const result = parsed.success
              ? await dashboardAction(parsed.data)
              : { status: 'validation_error' as const };
            if (result.status === 'success') {
              setReport(result.data);
              setMessage('Обзор обновлён.');
            } else {
              if (result.status === 'forbidden') setReport(null);
              setFailed(true);
              setMessage(
                result.status === 'forbidden'
                  ? 'Пространство недоступно.'
                  : 'Не удалось обновить обзор. Попробуйте ещё раз.',
              );
            }
          } catch {
            setFailed(true);
            setMessage('Не удалось обновить обзор. Попробуйте ещё раз.');
          }
        })}
      >
        <input type="hidden" {...register('workspaceId')} />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Обновляем…' : 'Обновить обзор'}
        </Button>
        <p ref={feedback} tabIndex={-1} role={failed ? 'alert' : 'status'}>
          {message}
        </p>
      </form>
      {report && (
        <>
          <p className="text-muted-foreground">
            Текущий месяц: {formatFinancialDate(report.monthFrom, locale)} —{' '}
            {formatFinancialDate(report.monthUntil, locale)} · {report.timezone}
          </p>
          <section
            aria-label="Общие средства"
            className="grid gap-3 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">Общие средства</h2>
            <p>
              Все счета, включая счета целей, резервов и архивные счета. Каждая
              сумма учтена один раз.
            </p>
            {report.balances.length ? (
              report.balances.map((t) => (
                <p
                  key={t.currency}
                  className="break-all text-2xl font-semibold"
                >
                  {money(t.amount, t.currency)}
                </p>
              ))
            ) : (
              <p>Общий остаток появится после создания счёта.</p>
            )}
          </section>
          <section
            aria-label="Счета"
            className="grid gap-3 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">Счета</h2>
            {!report.accounts.length && <p>Счетов пока нет.</p>}
            <ul className="grid gap-3 sm:grid-cols-2">
              {report.accounts.map((a) => (
                <li key={a.id} className="min-w-0 rounded border p-3">
                  <Link
                    className="break-words underline"
                    href={`${base}/accounts#account-${a.id}`}
                  >
                    {a.name}
                  </Link>
                  <p className="break-all">{money(a.balance, a.currency)}</p>
                  {a.archived && <p>Архивный счёт</p>}
                </li>
              ))}
            </ul>
            <Link className="underline" href={`${base}/accounts`}>
              Все счета
            </Link>
          </section>
          <section
            aria-label="Доходы и расходы месяца"
            className="grid gap-3 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">
              Доходы и расходы месяца · факт
            </h2>
            {!report.monthly.length && (
              <p>Доходов и расходов за текущий месяц нет.</p>
            )}
            {report.monthly.map((t) => (
              <div
                key={t.currency}
                className="min-w-0 break-words rounded border p-3"
              >
                <h3 className="font-medium">{t.currency}</h3>
                <p>Доходы: {money(t.income, t.currency)}</p>
                <p>Расходы: {money(t.expense, t.currency)}</p>
                <p>Разница: {money(t.difference, t.currency)}</p>
              </div>
            ))}
            <p>Переводы и начальные остатки не входят в доходы и расходы.</p>
            <Link
              className="underline"
              href={`${base}/operations?from=${report.monthFrom}&to=${report.monthUntil}`}
            >
              История месяца
            </Link>
          </section>
          <section
            aria-label="Бюджет месяца"
            className="grid gap-3 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">Бюджет месяца · план и факт</h2>
            {!report.budgets.length && <p>Бюджет на этот месяц не задан.</p>}
            {report.budgets.map((b) => (
              <div
                key={b.currency}
                className="min-w-0 break-words rounded border p-3"
              >
                <Link
                  className="underline"
                  href={`${base}/budget?month=${report.month}&currency=${b.currency}`}
                >
                  Бюджет {b.currency}
                </Link>
                <p>План дохода: {money(b.plannedIncome, b.currency)}</p>
                <p>План расходов: {money(b.plannedExpenses, b.currency)}</p>
                <p>Фактические расходы: {money(b.actual, b.currency)}</p>
                <p>Остаток бюджета: {money(b.remaining, b.currency)}</p>
                {b.categories.some((c) => c.exceeded) && (
                  <p>Есть превышенные категории</p>
                )}
              </div>
            ))}
            <Link
              className="underline"
              href={`${base}/budget?month=${report.month}`}
            >
              Настроить бюджет
            </Link>
          </section>
          <GoalCards
            title="Цели"
            empty="Активных целей нет."
            goals={report.goals}
            base={base}
            locale={locale}
          />
          <GoalCards
            title="Резервы"
            empty="Активных резервов нет."
            goals={report.reserves}
            base={base}
            locale={locale}
          />
          <section
            aria-label="Последние операции"
            className="grid gap-3 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">Последние операции</h2>
            {!report.latestActions.length && <p>Операций пока нет.</p>}
            <ul className="grid gap-3">
              {report.latestActions.map((a) => (
                <li
                  key={a.id}
                  className="min-w-0 break-words rounded border p-3"
                >
                  <Link
                    className="underline"
                    href={`${base}/operations?from=${a.date}&to=${a.date}`}
                  >
                    {a.kind === 'income'
                      ? 'Доход'
                      : a.kind === 'expense'
                        ? 'Расход'
                        : 'Перевод'}{' '}
                    · {formatFinancialDate(a.date, locale)}
                  </Link>
                  {a.legs.map((l) => (
                    <p key={`${l.accountId}:${l.role}`}>
                      {l.accountName} ·{' '}
                      {l.role === 'transfer_out'
                        ? 'Списание'
                        : l.role === 'transfer_in'
                          ? 'Зачисление'
                          : l.role === 'income'
                            ? 'Доход'
                            : 'Расход'}
                      : {money(l.amount, l.currency)}
                      {l.description && ` · ${l.description}`}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <Link className="underline" href={`${base}/operations`}>
              Вся история операций
            </Link>
          </section>
          <UpcomingPayments data={report.upcoming} locale={locale} />
        </>
      )}
    </>
  );
}
function GoalCards({
  title,
  empty,
  goals,
  base,
  locale,
}: {
  title: string;
  empty: string;
  goals: Goal[];
  base: string;
  locale: string;
}) {
  const decimal = (value: string) =>
    (
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
        .format as unknown as (value: string) => string
    )(value);
  return (
    <section aria-label={title} className="grid gap-3 rounded-lg border p-5">
      <h2 className="text-xl font-medium">{title}</h2>
      {!goals.length && <p>{empty}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {goals.map((g) => (
          <article
            key={g.id}
            className="min-w-0 break-words rounded border p-3"
          >
            <h3 className="font-medium">
              <Link className="underline" href={`${base}/goals#goal-${g.id}`}>
                {g.name}
              </Link>
            </h3>
            <p>
              Требуемая сумма:{' '}
              {formatMoney(g.progress.target, g.currency, locale)}
            </p>
            <p>
              Накоплено: {formatMoney(g.progress.actual, g.currency, locale)}
            </p>
            <p>
              Недостаёт: {formatMoney(g.progress.remaining, g.currency, locale)}
            </p>
            <p>
              {g.progress.status === 'deficit'
                ? 'Дефицит средств'
                : g.progress.status === 'no_obligation'
                  ? 'Обязательство отсутствует'
                  : g.progress.status === 'reached'
                    ? 'Цель достигнута'
                    : 'Накопление продолжается'}
            </p>
            {g.progress.percent !== null && (
              <p>Прогресс: {decimal(g.progress.percent)}%</p>
            )}
            {g.type === 'reserve' && (
              <p>
                {g.progress.coverage === null
                  ? 'Покрытие не рассчитывается'
                  : `Покрытие: ${decimal(g.progress.coverage)} из ${g.coverageMonths} месяцев`}
              </p>
            )}
          </article>
        ))}
      </div>
      <Link className="underline" href={`${base}/goals`}>
        Все цели и резервы
      </Link>
    </section>
  );
}
