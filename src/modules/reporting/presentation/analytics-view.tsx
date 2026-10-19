'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { analyticsInput } from '../domain/analytics-input';
import type { AnalyticsReport } from '../application/analytics';
import { analyticsAction } from './analytics-actions';
import { AnalyticsCharts } from './analytics-charts';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
type Selection = {
  period: 'current' | 'previous' | 'year' | 'custom';
  from: string;
  until: string;
};
export function AnalyticsView({
  workspaceId,
  initial,
  locale,
}: {
  workspaceId: string;
  initial: AnalyticsReport;
  locale: string;
}) {
  const [report, setReport] = useState(initial),
    [message, setMessage] = useState('');
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Selection>({
    defaultValues: {
      period: 'current',
      from: initial.from,
      until: initial.until,
    },
  });
  const period = useWatch({ control, name: 'period' });
  const money = (amount: string, currency: string) =>
    formatMoney(amount, currency, locale);
  async function submit(values: Selection) {
    setMessage('');
    const parsed = analyticsInput.safeParse(
      values.period === 'custom' ? values : { period: values.period },
    );
    if (!parsed.success) {
      setMessage('Проверьте даты: конец периода должен быть не раньше начала.');
      return;
    }
    try {
      const result = await analyticsAction(workspaceId, parsed.data);
      if (result.status === 'success') {
        setReport(result.data);
        setMessage('Отчёт обновлён.');
      } else
        setMessage(
          result.status === 'forbidden'
            ? 'Пространство недоступно.'
            : 'Не удалось загрузить отчёт. Попробуйте ещё раз.',
        );
    } catch {
      setMessage('Не удалось загрузить отчёт. Попробуйте ещё раз.');
    }
  }
  return (
    <>
      <form
        aria-label="Период аналитики"
        onSubmit={handleSubmit(submit)}
        className="flex flex-wrap items-end gap-3"
      >
        <label>
          Период
          <select className="block rounded border p-2" {...register('period')}>
            <option value="current">Текущий месяц</option>
            <option value="previous">Прошлый месяц</option>
            <option value="year">Год</option>
            <option value="custom">Произвольный период</option>
          </select>
        </label>
        {period === 'custom' && (
          <>
            <label>
              С даты
              <input
                type="date"
                className="block rounded border p-2"
                {...register('from')}
              />
            </label>
            <label>
              По дату
              <input
                type="date"
                className="block rounded border p-2"
                {...register('until')}
              />
            </label>
          </>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded border p-2"
        >
          {isSubmitting ? 'Загрузка…' : 'Показать отчёт'}
        </button>
        {message && (
          <p
            ref={feedback}
            tabIndex={-1}
            role={message === 'Отчёт обновлён.' ? 'status' : 'alert'}
          >
            {message}
          </p>
        )}
      </form>
      <p>
        С {formatFinancialDate(report.from, locale)} по{' '}
        {formatFinancialDate(report.until, locale)} включительно ·{' '}
        {report.timezone}
      </p>
      <p>Переводы исключены из доходов и расходов. Валюты показаны отдельно.</p>
      {report.totals.length === 0 && <p>Операций за выбранный период нет.</p>}
      {report.totals.map((t) => (
        <section
          key={t.currency}
          aria-label={`Итоги ${t.currency}`}
          className="rounded border p-4"
        >
          <h2>{t.currency}</h2>
          <p>Доходы: {money(t.income, t.currency)}</p>
          <p>Расходы: {money(t.expense, t.currency)}</p>
          <p>Разница: {money(t.difference, t.currency)}</p>
        </section>
      ))}
      <h2 className="text-2xl font-medium">Категории</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Структура доходов и расходов</caption>
          <thead>
            <tr>
              <th>Категория</th>
              <th>Тип</th>
              <th>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {report.categories.map((c) => (
              <tr key={`${c.currency}:${c.role}:${c.categoryId}`}>
                <td>{c.name}</td>
                <td>{c.role === 'income' ? 'Доход' : 'Расход'}</td>
                <td>{money(c.amount, c.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="text-2xl font-medium">Динамика</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Динамика по финансовым датам</caption>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Доходы</th>
              <th>Расходы</th>
            </tr>
          </thead>
          <tbody>
            {report.dynamics.map((d) => (
              <tr key={`${d.date}:${d.currency}`}>
                <td>{formatFinancialDate(d.date, locale)}</td>
                <td>{money(d.income, d.currency)}</td>
                <td>{money(d.expense, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AnalyticsCharts report={report} />
      <h2 className="text-2xl font-medium">Выполнение бюджета</h2>
      <p>
        Планы относятся к полным календарным месяцам; факт учитывает только
        выбранные даты. Планы не меняются при выборе периода.
      </p>
      {report.budgets.length === 0 && (
        <p>Бюджеты за выбранный период не заданы.</p>
      )}
      {report.budgets.map((b) => (
        <section
          key={`${b.month}:${b.currency}`}
          className="rounded border p-4"
        >
          <h3>
            {b.month} · {b.currency}
          </h3>
          <p>План доходов: {money(b.plannedIncome, b.currency)}</p>
          <p>План расходов: {money(b.plannedExpenses, b.currency)}</p>
          <p>
            Факт расходов в выбранном периоде: {money(b.actual, b.currency)}
          </p>
          <p>Остаток лимита: {money(b.remaining, b.currency)}</p>
        </section>
      ))}
      <h2 className="text-2xl font-medium">Счета — текущие остатки</h2>
      <p>
        Остатки и прогресс ниже актуальны на момент чтения, независимо от
        выбранного периода. Цели и резервы используют остатки своих счетов и не
        добавляются к ним повторно.
      </p>
      {report.accounts.length === 0 && <p>Счетов пока нет.</p>}
      {report.accounts.map((a) => (
        <p key={a.id}>
          {a.name}
          {a.archived ? ' (архив)' : ''}: {money(a.balance, a.currency)}
        </p>
      ))}
      <h2 className="text-2xl font-medium">
        Цели и резервы — текущий прогресс
      </h2>
      {report.goals.length === 0 && <p>Целей и резервов пока нет.</p>}
      {report.goals.map((g) => (
        <section key={g.id} className="rounded border p-4">
          <h3>
            {g.name} · {g.type === 'reserve' ? 'Резерв' : 'Цель'}
            {g.archived ? ' (архив)' : ''}
          </h3>
          <p>Накоплено: {money(g.progress.actual, g.currency)}</p>
          <p>Цель: {money(g.progress.target, g.currency)}</p>
          <p>Осталось: {money(g.progress.remaining, g.currency)}</p>
          <p>
            {g.progress.percent === null
              ? 'Процент не определён'
              : `Прогресс: ${g.progress.percent}%`}
          </p>
          {g.progress.coverage !== null && (
            <p>Покрытие: {g.progress.coverage} мес.</p>
          )}
        </section>
      ))}
    </>
  );
}
