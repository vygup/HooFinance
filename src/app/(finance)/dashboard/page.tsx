import Link from 'next/link';
import { readFamilies } from '@/modules/workspaces/application/family';
import {
  personalDashboard,
  readProfile,
} from '@/modules/identity/application/registration';
import { authenticatedRead } from '@/modules/identity/presentation/session';
export default async function Page() {
  const scope = await authenticatedRead(personalDashboard);
  const spaces = await authenticatedRead(readFamilies);
  const profile = await authenticatedRead(readProfile);
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
      <p className="text-muted-foreground">
        Операции и финансовые планы появятся на следующих этапах.
      </p>
    </>
  );
}
