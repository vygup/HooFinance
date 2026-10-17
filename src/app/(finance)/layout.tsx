import Link from 'next/link';
import { WorkspaceSwitcher } from '@/components/shared/workspace-switcher';
import { readSpaces } from '@/modules/workspaces/application/switching';
import { currentActor } from '@/server/security/access';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { LogoutButton } from '@/modules/identity/presentation/logout-button';
export const dynamic = 'force-dynamic';
export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await authenticatedRead(currentActor);
  const spaces = await authenticatedRead(readSpaces);
  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-5 border-b pb-6">
        <Link href="/dashboard" className="text-xl font-semibold">
          Finance Manager
        </Link>
        <nav
          aria-label="Личный кабинет"
          className="flex flex-wrap items-center gap-5"
        >
          <Link className="underline" href="/dashboard">
            Личное пространство
          </Link>
          <Link className="underline" href="/profile">
            Профиль
          </Link>
          <Link className="underline" href="/families">
            Семьи
          </Link>
          <LogoutButton />
        </nav>
      </header>
      <WorkspaceSwitcher {...spaces} />
      <main id="main" tabIndex={-1} className="grid gap-6 py-10">
        {children}
      </main>
    </div>
  );
}
