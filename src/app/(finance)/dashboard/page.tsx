import Link from 'next/link';
import { readWorkspaceDashboard } from '@/modules/reporting/application/dashboard';
import { DashboardView } from '@/modules/reporting/presentation/dashboard-view';
import { paymentDate } from '@/modules/obligations/application/recurring-payments-input';
import { todayInTimezone, occurrenceDate } from '@/shared/calendar/calendar';
import { readFamily } from '@/modules/workspaces/application/family';
import { readFamilies } from '@/modules/workspaces/application/family';
import {
  personalDashboard,
  readProfile,
} from '@/modules/identity/application/registration';
import { authenticatedRead } from '@/modules/identity/presentation/session';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; from?: string; until?: string }>;
}) {
  const scope = await authenticatedRead(personalDashboard);
  const spaces = await authenticatedRead(readFamilies);
  const profile = await authenticatedRead(readProfile);
  const query = await searchParams;
  const selected =
    spaces.active.find((s) => s.id === query.workspace) ??
    spaces.active.find((s) => s.id === scope.id)!;
  const timezone =
    selected.kind === 'family'
      ? (await authenticatedRead((h) => readFamily(h, selected.id))).timezone
      : profile.timezone;
  const today = todayInTimezone(timezone);
  const from = paymentDate.safeParse(query.from).success ? query.from! : today;
  const until =
    paymentDate.safeParse(query.until).success && query.until! >= from
      ? query.until!
      : occurrenceDate(from, 1, 'month');
  const payments = await authenticatedRead((h) =>
    readWorkspaceDashboard(h, { workspaceId: selected.id, from, until }),
  );
  const date = new Intl.DateTimeFormat(profile.locale, {
    dateStyle: 'long',
    timeZone: profile.timezone,
  }).format(new Date());
  return (
    <>
      <h1 className="text-3xl font-semibold">{scope.name}</h1>
      <p className="break-words">Здравствуйте, {profile.name}!</p>
      <p className="text-muted-foreground">
        {date} · {profile.timezone}
      </p>
      <section
        aria-label="Доступные пространства"
        className="rounded-lg border p-6"
      >
        <h2 className="text-xl font-medium">Ваше личное пространство</h2>
        <p className="mt-2">Доступно только вам.</p>
        <Link className="underline" href={`/w/${scope.id}`}>
          Обзор личного пространства
        </Link>
        <Link className="underline" href={`/w/${scope.id}/accounts`}>
          Счета личного пространства
        </Link>
        <ul className="mt-4 grid gap-2">
          {spaces.active
            .filter((s) => s.kind === 'family')
            .map((s) => (
              <li key={s.id}>
                <Link
                  className="underline"
                  href={`/families?workspace=${s.id}`}
                >
                  {s.name} · семейное
                </Link>
              </li>
            ))}
        </ul>
      </section>
      <form
        data-navigation-form
        aria-label="Платежи пространства"
        className="flex flex-wrap gap-3"
      >
        <label>
          Пространство
          <select
            name="workspace"
            defaultValue={selected.id}
            className="rounded border p-2"
          >
            {spaces.active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          С даты
          <input
            name="from"
            type="date"
            defaultValue={from}
            className="rounded border p-2"
          />
        </label>
        <label>
          По дату
          <input
            name="until"
            type="date"
            defaultValue={until}
            className="rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded border p-2">
          Показать платежи
        </button>
      </form>
      <DashboardView
        key={selected.id}
        initial={payments}
        locale={profile.locale}
        interval={{ from, until }}
      />
    </>
  );
}
