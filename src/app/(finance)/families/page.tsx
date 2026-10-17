import Link from 'next/link';
import { readProfile } from '@/modules/identity/application/registration';
import { headers } from 'next/headers';
import {
  readFamilies,
  readFamily,
} from '@/modules/workspaces/application/family';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import {
  CreateFamilyForm,
  FamilyForms,
} from '@/modules/workspaces/presentation/family-forms';
import { historyRows } from '@/modules/data-exchange/application/export-history';
import { AccessError } from '@/server/security/access';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; history?: string }>;
}) {
  const profile = await authenticatedRead(readProfile);
  const list = await authenticatedRead(readFamilies),
    query = await searchParams;
  const selected =
    query.history ??
    query.workspace ??
    list.active.find((s) => s.kind === 'family')?.id;
  let detail = null,
    rows = null,
    denied = false;
  if (selected) {
    try {
      detail = await readFamily(
        new Headers(await headers()),
        selected,
        !!query.history,
      );
      if (query.history)
        rows = await historyRows(new Headers(await headers()), selected);
    } catch (error) {
      if (error instanceof AccessError) denied = true;
      else throw error;
    }
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Семьи</h1>
      <nav aria-label="Доступные пространства" className="flex flex-wrap gap-4">
        {list.active.map((s) => (
          <Link
            className="break-words underline"
            key={s.id}
            href={
              s.kind === 'personal'
                ? '/dashboard'
                : `/families?workspace=${s.id}`
            }
          >
            {s.name} · {s.kind === 'personal' ? 'личное' : 'семейное'}
          </Link>
        ))}
      </nav>
      {denied && <p role="alert">Пространство недоступно.</p>}
      {detail && !detail.deleted && (
        <section className="grid gap-5 rounded-lg border p-5">
          <h2 className="break-words text-2xl font-medium">{detail.name}</h2>
          <FamilyForms key={detail.id} scope={detail} actorId={list.actorId} />
        </section>
      )}
      {detail?.deleted && rows && (
        <section className="grid gap-4 rounded-lg border p-5">
          <h2 className="text-2xl font-medium">Сохранённая история</h2>
          <p className="break-words">{detail.name} · Только просмотр</p>
          <a
            className="underline"
            href={`/api/workspaces/${detail.id}/csv/export`}
          >
            Экспорт CSV
          </a>
          {rows.length === 0 ? (
            <p>Операций пока нет.</p>
          ) : (
            <ul className="grid gap-4">
              {rows.map((row) => (
                <li className="break-words rounded-md border p-3" key={row.id}>
                  {row.date} · {row.account} ·{' '}
                  {row.type === 'transfer'
                    ? row.direction === 'out'
                      ? 'Перевод со счёта'
                      : 'Перевод на счёт'
                    : row.type === 'income'
                      ? 'Доход'
                      : 'Расход'}{' '}
                  · {row.amount} {row.currency}
                  <p className="whitespace-pre-wrap">{row.description}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <CreateFamilyForm timezone={profile.timezone} />
      <section className="grid gap-3">
        <h2 className="text-2xl font-medium">Удалённые семьи</h2>
        {list.deleted.length === 0 ? (
          <p>Удалённых семей нет.</p>
        ) : (
          list.deleted.map((s) => (
            <div key={s.id} className="break-words rounded-md border p-4">
              <p>{s.name}</p>
              <Link className="underline" href={`/families?history=${s.id}`}>
                Просмотреть историю
              </Link>
            </div>
          ))
        )}
      </section>
    </>
  );
}
