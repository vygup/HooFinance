import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { SavingsPlan } from '@/modules/goals/presentation/savings-plan';
import { ReserveSettings } from '@/modules/goals/presentation/reserve-settings';
import { WithdrawalSummary } from '@/modules/goals/presentation/withdrawal-summary';
import { FundingHistory } from '@/modules/goals/presentation/funding-history';
import { readTransferOptions } from '@/modules/ledger/application/transfers';
import { readFamily } from '@/modules/workspaces/application/family';
import { todayInTimezone } from '@/shared/calendar/calendar';
import Link from 'next/link';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { readProfile } from '@/modules/identity/application/registration';
import { readFamilies } from '@/modules/workspaces/application/family';
import { readGoals } from '@/modules/goals/application/reserve';
import { ReserveForm } from '@/modules/goals/presentation/reserve-form';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import { AccessError } from '@/server/security/access';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const profile = await authenticatedRead(readProfile),
    scopes = await authenticatedRead(readFamilies);
  const scope = scopes.active.find((s) => s.id === workspaceId);
  if (!scope) return <AccessDenied workspaceId={workspaceId} />;
  let data;
  try {
    data = await authenticatedRead((h) => readGoals(h, workspaceId));
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  const transferAccounts = await authenticatedRead((h) =>
    readTransferOptions(h, workspaceId),
  );
  const timezone =
    scope.kind === 'family'
      ? (await authenticatedRead((h) => readFamily(h, workspaceId))).timezone
      : profile.timezone;
  const today = todayInTimezone(timezone);
  return (
    <>
      <h1 className="text-3xl font-semibold">Цели и резервы · {scope.name}</h1>
      <p>
        {scope.kind === 'personal'
          ? 'Личное пространство · доступно только вам'
          : 'Семейное пространство · общие цели'}
      </p>
      <nav aria-label="Цели пространств" className="flex flex-wrap gap-3">
        {scopes.active.map((s) => (
          <a key={s.id} className="underline" href={`/w/${s.id}/goals`}>
            {s.name} · {s.kind === 'personal' ? 'личное' : 'семейное'}
          </a>
        ))}
      </nav>
      <Link className="underline" href={`/w/${workspaceId}/accounts`}>
        Счета и история накоплений
      </Link>
      <p>
        Накопления — полный баланс связанного счёта. Цель не добавляет деньги к
        общим средствам. Создание, изменение и архивация цели не меняют баланс.
      </p>
      <ReserveForm
        key={workspaceId}
        locale={profile.locale}
        workspaceId={workspaceId}
        accounts={data.accounts}
      />
      {data.goals.length === 0 && <p>Целей пока нет.</p>}
      {data.goals.map((g) => {
        const money = (value: string) =>
          formatMoney(value, g.currency, profile.locale);
        return (
          <section
            key={g.id}
            aria-label={`Цель ${g.name}`}
            className="grid gap-3 rounded-lg border p-5 break-words"
          >
            <h2 className="text-xl font-medium">
              {g.name} ·{' '}
              {g.type === 'reserve' ? 'Резервный фонд' : 'Обычная цель'}
            </h2>
            {g.description && <p>{g.description}</p>}
            <p>Связанный счёт: {g.accountName}</p>
            {g.targetDate && (
              <p>
                Желаемая дата:{' '}
                {formatFinancialDate(g.targetDate, profile.locale)}
              </p>
            )}
            {g.archived && <p>Архивная цель</p>}
            <p>Требуемая сумма: {money(g.progress.target)}</p>
            <p>Накоплено: {money(g.progress.actual)}</p>
            <p>Недостаёт: {money(g.progress.remaining)}</p>
            {g.progress.status === 'no_obligation' ? (
              <p>Обязательство отсутствует</p>
            ) : g.progress.status === 'deficit' ? (
              <p>Дефицит средств</p>
            ) : (
              <>
                <p>Прогресс: {g.progress.percent?.replace('.', ',')}%</p>
                <p>
                  {g.progress.reached
                    ? 'Цель достигнута'
                    : 'Цель ещё не достигнута'}
                </p>
              </>
            )}
            {g.progress.status === 'no_obligation' && g.progress.deficit && (
              <p>Дефицит средств на счёте</p>
            )}
            {g.progress.coverage !== null && (
              <p>
                Покрытие: {g.progress.coverage.replace('.', ',')} из{' '}
                {g.coverageMonths} месяцев
              </p>
            )}
            <Link className="underline" href={`/w/${workspaceId}/accounts`}>
              История счёта {g.accountName}
            </Link>
            <FundingHistory
              key={`${g.id}:${g.version}`}
              workspaceId={workspaceId}
              view={data.funding.find((v) => v.goal.id === g.id)!}
              accounts={transferAccounts}
              today={today}
              locale={profile.locale}
            />
            <WithdrawalSummary
              categories={data.expenseCategories}
              workspaceId={workspaceId}
              view={data.funding.find((v) => v.goal.id === g.id)!}
              accounts={transferAccounts}
              today={today}
            />
            {!g.archived && (
              <SavingsPlan
                key={`savings:${data.savings.find((s) => s.goalId === g.id)!.version}`}
                workspaceId={workspaceId}
                goal={data.savings.find((s) => s.goalId === g.id)!}
                currency={g.currency}
                locale={profile.locale}
              />
            )}
            {!g.archived && g.type === 'reserve' && (
              <ReserveSettings
                key={`settings:${g.version}`}
                workspaceId={workspaceId}
                goal={g}
              />
            )}
            {!g.archived && (
              <ReserveForm
                key={g.version}
                locale={profile.locale}
                workspaceId={workspaceId}
                goal={g}
                accounts={data.accounts}
              />
            )}
          </section>
        );
      })}
    </>
  );
}
