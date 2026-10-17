import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { readProfile } from '@/modules/identity/application/registration';
import {
  readFamilies,
  readFamily,
} from '@/modules/workspaces/application/family';
import { readMonthlyBudget } from '@/modules/budgeting/application/monthly-budget';
import { MonthlyBudgetForm } from '@/modules/budgeting/presentation/monthly-budget-form';
import {
  budgetMonth,
  budgetCurrency,
} from '@/modules/budgeting/domain/monthly-budget';
import { todayInTimezone } from '@/shared/calendar/calendar';
import { currencyCatalog } from '@/shared/money/currency';
import { formatMoney } from '@/shared/money/format';
import { AccessError } from '@/server/security/access';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ month?: string; currency?: string }>;
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
  const query = await searchParams;
  const month = budgetMonth.safeParse(query.month).success
    ? query.month!
    : todayInTimezone(timezone).slice(0, 7);
  const currency = budgetCurrency.safeParse(query.currency).success
    ? query.currency!
    : 'RUB';
  let data;
  try {
    data = await authenticatedRead((h) =>
      readMonthlyBudget(h, workspaceId, month, currency),
    );
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  const { budget, summary, categories } = data;
  const money = (value: string) => formatMoney(value, currency, profile.locale);
  return (
    <>
      <h1 className="text-3xl font-semibold">Месячный бюджет · {scope.name}</h1>
      <p>
        {scope.kind === 'personal'
          ? 'Личное пространство · доступно только вам'
          : 'Семейное пространство · общие планы'}
      </p>
      <Link className="underline" href={`/w/${workspaceId}/accounts`}>
        Счета и категории
      </Link>
      <nav aria-label="Бюджеты пространств" className="flex flex-wrap gap-3">
        {scopes.active.map((s) => (
          <a key={s.id} className="underline" href={`/w/${s.id}/budget`}>
            {s.name} · {s.kind === 'personal' ? 'личное' : 'семейное'}
          </a>
        ))}
      </nav>
      <form
        data-navigation-form
        aria-label="Период бюджета"
        className="flex flex-wrap items-end gap-3"
      >
        <label>
          Месяц бюджета
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="block rounded border bg-background p-2"
          />
        </label>
        <label>
          Валюта бюджета
          <select
            name="currency"
            defaultValue={currency}
            className="block rounded border bg-background p-2"
          >
            {currencyCatalog().map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </select>
        </label>
        <Button type="submit">Показать бюджет</Button>
      </form>
      {!budget ? (
        <p>Бюджет не создан</p>
      ) : (
        <section
          aria-label="Итоги бюджета"
          className="grid gap-2 rounded border p-5"
        >
          <p>План доходов: {money(budget.plannedIncome)}</p>
          <p>План расходов: {money(summary.plannedExpenses)}</p>
          <p>Плановый остаток: {money(summary.plannedRemainder)}</p>
          <p>Общий остаток бюджета: {money(summary.remaining)}</p>
        </section>
      )}
      <p>Фактические расходы: {money(summary.actual)}</p>
      <p>
        Факт включает все расходы выбранного месяца. Переводы и начальные
        остатки не учитываются. Валюты показываются отдельно.
      </p>
      <section aria-label="Факт по категориям" className="grid gap-3">
        {summary.categories.map((c) => (
          <article key={c.categoryId} className="rounded border p-4">
            <h2 className="font-medium">
              {categories.find((cat) => cat.id === c.categoryId)?.name ??
                'Категория'}
            </h2>
            <p>Факт: {money(c.actual)}</p>
            {c.limit === null ? (
              <p>Без лимита</p>
            ) : (
              <>
                <p>Лимит: {money(c.limit)}</p>
                <p>Остаток: {money(c.remaining!)}</p>
                <p>
                  {c.percent === null
                    ? 'Нулевой лимит · процент не рассчитывается'
                    : `Использование: ${c.percent.replace('.', ',')}%`}
                </p>
                {c.exceeded && (
                  <p className="font-semibold">Превышение лимита</p>
                )}
              </>
            )}
          </article>
        ))}
      </section>
      <MonthlyBudgetForm
        key={`${workspaceId}:${month}:${currency}:${budget?.version ?? 'new'}`}
        workspaceId={workspaceId}
        month={month}
        currency={currency}
        budget={budget}
        categories={categories}
      />
    </>
  );
}
