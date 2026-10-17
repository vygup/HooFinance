import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { readHistory } from '@/modules/ledger/application/history-corrections';
import { historyFilters } from '@/modules/ledger/domain/history-corrections';
import { HistoryCorrectionForm } from '@/modules/ledger/presentation/history-correction-form';
import { readTransferOptions } from '@/modules/ledger/application/transfers';
import { readFamilies } from '@/modules/workspaces/application/family';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { AccessError } from '@/server/security/access';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';

export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const scopes = await authenticatedRead(readFamilies);
  const scope = scopes.active.find((s) => s.id === workspaceId);
  if (!scope) return <AccessDenied workspaceId={workspaceId} />;
  const query = await searchParams;
  const candidate = Object.fromEntries(
    ['from', 'to', 'accountId', 'categoryId', 'text'].flatMap((key) =>
      typeof query[key] === 'string' && query[key] !== ''
        ? [[key, query[key]]]
        : [],
    ),
  );
  const parsed = historyFilters.safeParse(candidate);
  let data, transferAccounts;
  try {
    data = await authenticatedRead((h) =>
      readHistory(h, workspaceId, parsed.success ? parsed.data : {}),
    );
    transferAccounts = await authenticatedRead((h) =>
      readTransferOptions(h, workspaceId, true),
    );
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  const accounts = [
    ...data.accounts,
    ...transferAccounts.filter((a) => a.workspaceId !== workspaceId),
  ];
  const inputClass = 'block w-full rounded-md border bg-background px-3 py-2';
  return (
    <>
      <h1 className="text-3xl font-semibold">
        История операций · {scope.name}
      </h1>
      <p>
        {scope.kind === 'personal'
          ? 'Личное пространство · доступно только вам'
          : 'Семейное пространство · общие средства'}
      </p>
      <Link className="underline" href={`/w/${workspaceId}/accounts`}>
        Счета и остатки
      </Link>
      <form
        data-navigation-form
        aria-label="Поиск операций"
        className="grid gap-3 rounded-lg border p-5 sm:grid-cols-2"
      >
        <label>
          С даты
          <input
            type="date"
            name="from"
            className={inputClass}
            defaultValue={typeof query.from === 'string' ? query.from : ''}
          />
        </label>
        <label>
          По дату
          <input
            type="date"
            name="to"
            className={inputClass}
            defaultValue={typeof query.to === 'string' ? query.to : ''}
          />
        </label>
        <label>
          Счёт
          <select
            name="accountId"
            className={inputClass}
            defaultValue={
              typeof query.accountId === 'string' ? query.accountId : ''
            }
          >
            <option value="">Все счета</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Категория
          <select
            name="categoryId"
            className={inputClass}
            defaultValue={
              typeof query.categoryId === 'string' ? query.categoryId : ''
            }
          >
            <option value="">Все категории</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поиск по описанию
          <input
            name="text"
            className={inputClass}
            defaultValue={typeof query.text === 'string' ? query.text : ''}
          />
        </label>
        <Button type="submit">Найти</Button>
        <Link className="underline" href={`/w/${workspaceId}/operations`}>
          Сбросить фильтры
        </Link>
      </form>
      {!parsed.success && <p role="alert">Проверьте фильтры и порядок дат.</p>}
      {parsed.success && data.actions.length === 0 && (
        <p>Операций по выбранным условиям нет.</p>
      )}
      {parsed.success &&
        data.actions.map((a) => (
          <article
            key={a.id}
            aria-label="Операция"
            className="grid min-w-0 gap-4 rounded-lg border p-5"
          >
            <h2 className="text-xl font-medium">
              {{ income: 'Доход', expense: 'Расход', transfer: 'Перевод' }[
                a.kind
              ] ?? a.kind}
            </h2>
            <p>
              Версия {a.version} ·{' '}
              {a.status === 'deleted' ? 'Удалена' : 'Активна'}
            </p>
            <p className="break-all">
              Создал: {a.creatorId} ·{' '}
              {new Date(a.createdAt).toLocaleString('ru-RU', {
                timeZone: 'UTC',
              })}{' '}
              UTC
            </p>
            {a.legs.map((l) => (
              <p key={l.role} className="break-words">
                {formatFinancialDate(l.financialDate)} ·{' '}
                {
                  data.accounts.find((account) => account.id === l.accountId)
                    ?.name
                }{' '}
                · {formatMoney(l.amount, l.currency)} · {l.description}
              </p>
            ))}
            {a.canEdit && (
              <HistoryCorrectionForm
                key={`${a.id}:${a.version}`}
                action={a}
                accounts={accounts}
                categories={data.categories}
              />
            )}
            {a.status === 'active' && !a.canEdit && (
              <p>
                Изменение межпространственного перевода доступно владельцу
                личной стороны при действующем доступе к семье.
              </p>
            )}
            <details>
              <summary className="cursor-pointer">История изменений</summary>
              <ol className="grid gap-3 pt-3">
                {a.revisions.map((r) => (
                  <li key={r.revision} className="break-words">
                    <p>
                      Версия {r.revision} ·{' '}
                      {r.status === 'deleted' ? 'Удаление' : 'Сохранение'} ·
                      автор <span className="break-all">{r.actorId}</span> ·{' '}
                      {new Date(r.happenedAt).toLocaleString('ru-RU', {
                        timeZone: 'UTC',
                      })}{' '}
                      UTC
                    </p>
                    {r.legs.map((l) => (
                      <p key={l.role}>
                        {l.financialDate} · {l.amount} {l.currency} ·{' '}
                        {data.accounts.find((a) => a.id === l.accountId)?.name}{' '}
                        ·{' '}
                        {
                          data.categories.find((c) => c.id === l.categoryId)
                            ?.name
                        }{' '}
                        · {l.description}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            </details>
          </article>
        ))}
    </>
  );
}
