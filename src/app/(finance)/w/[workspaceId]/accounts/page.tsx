import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { TransferForm } from '@/modules/ledger/presentation/transfer-form';
import { readTransferOptions } from '@/modules/ledger/application/transfers';
import { ExpenseForm } from '@/modules/ledger/presentation/expense-form';
import { CategoryManager } from '@/modules/categories/presentation/category-manager';
import { readIncomeAccounts } from '@/modules/ledger/application/income';
import { IncomeForm } from '@/modules/ledger/presentation/income-form';
import { todayInTimezone } from '@/shared/calendar/calendar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import { readProfile } from '@/modules/identity/application/registration';
import { AccountForm } from '@/modules/ledger/presentation/account-forms';
import { accountTypes } from '@/modules/ledger/domain/accounts';
import { currencyCatalog } from '@/shared/money/currency';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { AccessError } from '@/server/security/access';
import {
  readFamilies,
  readFamily,
} from '@/modules/workspaces/application/family';
function AuditValues({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <p>Счёт ещё не создан.</p>;
  const fields = value as Record<string, unknown>;
  return (
    <dl>
      {Object.entries({
        name: 'Название',
        openingBalance: 'Начальный остаток',
        balance: 'Текущий баланс',
        description: 'Описание',
      }).map(([key, label]) => (
        <div key={key}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{typeof fields[key] === 'string' ? fields[key] : '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { workspaceId } = await params;
  const profile = await authenticatedRead(readProfile);
  const scopes = await authenticatedRead(readFamilies);
  const scope = scopes.active.find((s) => s.id === workspaceId);
  if (!scope) return <AccessDenied workspaceId={workspaceId} />;
  const timezone =
    scope.kind === 'family'
      ? (await authenticatedRead((h) => readFamily(h, workspaceId))).timezone
      : profile.timezone;
  const today = todayInTimezone(timezone);
  const requestedMonth = (await searchParams).month;
  const month =
    requestedMonth &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) &&
    !requestedMonth.startsWith('0000')
      ? requestedMonth
      : today.slice(0, 7);
  let data;
  try {
    data = await authenticatedRead((h) =>
      readIncomeAccounts(h, workspaceId, month),
    );
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  const transferAccounts = await authenticatedRead((h) =>
    readTransferOptions(h, workspaceId),
  );
  const income = data.income;
  const { categories, expenses } = data;
  return (
    <>
      <h1 className="text-3xl font-semibold">Счета · {scope.name}</h1>
      <p>
        {scope.kind === 'personal'
          ? 'Личное пространство · доступно только вам'
          : 'Семейное пространство · общие средства'}
      </p>
      <nav
        aria-label="Финансовые пространства"
        className="flex flex-wrap gap-4"
      >
        {scopes.active.map((s) => (
          <a
            key={s.id}
            href={`/w/${s.id}/accounts`}
            aria-current={s.id === workspaceId ? 'page' : undefined}
            className="underline"
          >
            {s.name} · {s.kind === 'personal' ? 'личное' : 'семейное'}
          </a>
        ))}
      </nav>
      <Link className="underline" href={`/w/${workspaceId}/budget`}>
        Месячный бюджет
      </Link>
      <Link className="underline" href={`/w/${workspaceId}/goals`}>
        Цели и резервы
      </Link>
      <section aria-label="Общие остатки" className="rounded-lg border p-5">
        {data.totals.map((t) => (
          <p className="break-all" key={t.currency}>
            Общий остаток: {formatMoney(t.amount, t.currency, profile.locale)}
          </p>
        ))}
        <p className="text-muted-foreground">
          Включая архивные счета. Валюты учитываются отдельно. Начальный остаток
          не является доходом.
        </p>
      </section>
      <section className="rounded-lg border p-5">
        <AccountForm
          workspaceId={workspaceId}
          mode="create"
          currencies={currencyCatalog().map((c) => c.code)}
        />
      </section>
      <IncomeForm
        key={workspaceId}
        workspaceId={workspaceId}
        accounts={data.availableAccounts}
        categories={income.categories}
        today={today}
      />
      <section
        aria-label="Доходы за месяц"
        className="grid gap-3 rounded-lg border p-5"
      >
        <form
          data-navigation-form
          aria-label="Период доходов"
          className="flex flex-wrap items-end gap-3"
        >
          <label>
            Месяц доходов
            <input
              className="block rounded-md border bg-background px-3 py-2"
              type="month"
              name="month"
              defaultValue={month}
            />
          </label>
          <Button type="submit">Показать доходы</Button>
        </form>
        {income.totals.length === 0 && <p>Доходов за месяц нет.</p>}
        {income.totals.map((t) => (
          <p key={t.currency} className="break-all">
            Доход за месяц: {formatMoney(t.amount, t.currency, profile.locale)}
          </p>
        ))}
      </section>
      <ExpenseForm
        key={`expense:${workspaceId}`}
        workspaceId={workspaceId}
        accounts={data.availableAccounts}
        categories={categories.filter(
          (c) => c.kind === 'expense' && !c.archived,
        )}
        today={today}
      />
      <section aria-label="Расходы за месяц" className="rounded-lg border p-5">
        {expenses.totals.length === 0 && <p>Расходов за месяц нет.</p>}
        {expenses.totals.map((t) => (
          <p key={t.currency}>
            Расход за месяц: {formatMoney(t.amount, t.currency, profile.locale)}
          </p>
        ))}
      </section>
      <TransferForm
        key={`transfer:${workspaceId}`}
        workspaceId={workspaceId}
        accounts={transferAccounts}
        today={today}
      />
      <CategoryManager workspaceId={workspaceId} categories={categories} />
      {data.accounts.length === 0 && <p>Счетов пока нет.</p>}
      {data.accounts.map((a) => (
        <article
          key={a.id}
          aria-label={a.name}
          className="grid min-w-0 gap-4 rounded-lg border p-5"
        >
          <h2 className="break-words text-2xl font-medium">{a.name}</h2>
          <p>
            {accountTypes[a.type as keyof typeof accountTypes] ?? a.type} ·{' '}
            <span>{a.archived ? 'Архивный счёт' : 'Активный счёт'}</span>
          </p>
          <p className="break-all">
            Текущий баланс: {formatMoney(a.balance, a.currency, profile.locale)}
          </p>
          {a.balance.startsWith('-') && <p>Дефицит средств</p>}
          <p className="break-all">
            Начальный остаток:{' '}
            {formatMoney(a.openingBalance, a.currency, profile.locale)}
          </p>
          <AccountForm workspaceId={workspaceId} account={a} mode="update" />
          <AccountForm
            workspaceId={workspaceId}
            account={a}
            mode="correctOpening"
          />
          {!a.archived && (
            <AccountForm workspaceId={workspaceId} account={a} mode="archive" />
          )}
          <h3 className="text-xl font-medium">История операций</h3>
          {a.history.length === 0 && <p>Операций пока нет.</p>}
          <ul className="grid gap-2">
            {a.history.map((h) => (
              <li className="break-words" key={h.id}>
                {formatFinancialDate(h.date, profile.locale)} ·{' '}
                {{
                  income: 'Доход',
                  expense: 'Расход',
                  transfer_in: 'Перевод на счёт',
                  transfer_out: 'Перевод со счёта',
                }[h.role] ?? h.role}
                : {formatMoney(h.amount, a.currency, profile.locale)} · остаток{' '}
                {formatMoney(h.balance, a.currency, profile.locale)}
                {h.description && ` · ${h.description}`}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer">Аудит изменений</summary>
            <ul className="grid gap-3 pt-3">
              {a.audit.map((e) => (
                <li key={e.id} className="break-all">
                  {{
                    create: 'Создание счёта',
                    update: 'Изменение описания',
                    correctOpening: 'Исправление начального остатка',
                    archive: 'Архивация',
                  }[e.kind] ?? 'Изменение счёта'}{' '}
                  ·{' '}
                  {new Intl.DateTimeFormat(profile.locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: profile.timezone,
                  }).format(new Date(e.occurredAt))}{' '}
                  · автор {e.actorId}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <h4>До изменения</h4>
                      <AuditValues value={e.before} />
                    </div>
                    <div>
                      <h4>После изменения</h4>
                      <AuditValues value={e.after} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </>
  );
}
