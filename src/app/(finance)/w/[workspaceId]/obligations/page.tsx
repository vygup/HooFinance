import Link from 'next/link';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { readProfile } from '@/modules/identity/application/registration';
import {
  readFamilies,
  readFamily,
} from '@/modules/workspaces/application/family';
import { readGoals } from '@/modules/goals/application/reserve';
import { readObligations } from '@/modules/obligations/application/recurring-payments';
import { paymentDate } from '@/modules/obligations/application/recurring-payments-input';
import {
  ObligationEditor,
  ObligationLifecycle,
  PaymentForm,
  ReserveObligationLink,
} from '@/modules/obligations/presentation/recurring-payments-forms';
import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { AccessError } from '@/server/security/access';
import {
  todayInTimezone,
  occurrenceDate,
  formatFinancialDate,
} from '@/shared/calendar/calendar';
import { formatMoney } from '@/shared/money/format';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ from?: string; until?: string }>;
}) {
  const { workspaceId } = await params;
  const profile = await authenticatedRead(readProfile),
    scopes = await authenticatedRead(readFamilies);
  const scope = scopes.active.find((s) => s.id === workspaceId);
  if (!scope) return <AccessDenied workspaceId={workspaceId} />;
  const timezone =
    scope.kind === 'family'
      ? (await authenticatedRead((h) => readFamily(h, workspaceId))).timezone
      : profile.timezone;
  const today = todayInTimezone(timezone),
    query = await searchParams;
  const from = paymentDate.safeParse(query.from).success ? query.from! : today;
  const until =
    paymentDate.safeParse(query.until).success && query.until! >= from
      ? query.until!
      : occurrenceDate(from, 1, 'month');
  let data, goals;
  try {
    data = await authenticatedRead((h) =>
      readObligations(h, workspaceId, from, until),
    );
    goals = await authenticatedRead((h) => readGoals(h, workspaceId));
  } catch (e) {
    if (e instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw e;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">
        Регулярные обязательства · {scope.name}
      </h1>
      <nav className="flex flex-wrap gap-3">
        <Link className="underline" href={`/w/${workspaceId}/accounts`}>
          Счета
        </Link>
        <Link className="underline" href={`/w/${workspaceId}/goals`}>
          Цели и резервы
        </Link>
      </nav>
      <p>
        План не меняет баланс. Расход появляется после подтверждения оплаты.
        Просроченные платежи показаны независимо от выбранного интервала.
      </p>
      <form
        data-navigation-form
        aria-label="Интервал платежей"
        className="flex flex-wrap gap-3"
      >
        <label>
          С даты
          <input
            className="rounded border p-2"
            type="date"
            name="from"
            defaultValue={from}
          />
        </label>
        <label>
          По дату
          <input
            className="rounded border p-2"
            type="date"
            name="until"
            defaultValue={until}
          />
        </label>
        <button className="rounded border p-2" type="submit">
          Показать
        </button>
      </form>
      <ObligationEditor
        key={workspaceId}
        workspaceId={workspaceId}
        data={data}
      />
      {data.obligations.length === 0 && <p>Обязательств пока нет.</p>}
      {data.obligations.map((o) => (
        <section
          aria-label={`Обязательство ${o.name}`}
          key={o.id}
          className="grid gap-3 rounded border p-4 break-words"
        >
          <h2 className="text-xl font-medium">{o.name}</h2>
          <p>
            {formatMoney(o.amount, o.currency, profile.locale)} · каждые{' '}
            {o.repeatEvery}{' '}
            {
              (
                {
                  day: 'дн.',
                  week: 'нед.',
                  month: 'мес.',
                  year: 'г.',
                } as Record<string, string>
              )[o.repeatUnit]
            }
          </p>
          <p>
            {o.status === 'active'
              ? 'Активно'
              : o.status === 'paused'
                ? 'Приостановлено'
                : 'Архивировано'}
          </p>
          <ObligationLifecycle
            key={`status:${o.id}:${o.version}`}
            workspaceId={workspaceId}
            obligation={o}
          />
          {o.status !== 'archived' && (
            <details>
              <summary>Изменить расписание</summary>
              <p>
                Наступившие и оплаченные платежи сохраняются. Будущие
                неоплаченные пересчитываются.
              </p>
              <ObligationEditor
                key={`${o.id}:${o.version}`}
                workspaceId={workspaceId}
                data={data}
                obligation={o}
              />
            </details>
          )}
        </section>
      ))}
      <h2 className="text-2xl font-medium">Платежи: план и факт</h2>
      {data.totals.map((t) => (
        <p key={t.currency}>
          Неоплаченный план с просрочкой:{' '}
          {formatMoney(t.amount, t.currency, profile.locale)}
        </p>
      ))}
      {data.payments.length === 0 && <p>Платежей за выбранный интервал нет.</p>}
      {data.payments.map((p) => (
        <section
          key={p.id}
          aria-label={`Платёж ${p.name} ${p.scheduledDate}`}
          className="grid gap-2 rounded border p-4"
        >
          <h3>
            {p.name} · {formatFinancialDate(p.scheduledDate, profile.locale)}
          </h3>
          <p>
            План: {formatMoney(p.scheduledAmount, p.currency, profile.locale)}
          </p>
          <p>
            {p.status === 'paid'
              ? 'Оплачено'
              : p.overdue
                ? 'Просрочено'
                : 'Предстоящий платёж'}
          </p>
          {p.actualAmount !== null && (
            <p>
              Факт: {formatMoney(p.actualAmount, p.currency, profile.locale)} ·{' '}
              {formatFinancialDate(p.actualDate!, profile.locale)}
            </p>
          )}
          <PaymentForm
            workspaceId={workspaceId}
            payment={p}
            today={today}
            accounts={data.accounts}
          />
        </section>
      ))}
      <h2 className="text-2xl font-medium">Связь с резервами</h2>
      {goals.goals
        .filter((g) => g.type === 'reserve' && !g.archived)
        .map((g) => (
          <ReserveObligationLink
            key={`${g.id}:${g.version}`}
            workspaceId={workspaceId}
            goal={g}
            obligations={data.obligations}
          />
        ))}
    </>
  );
}
