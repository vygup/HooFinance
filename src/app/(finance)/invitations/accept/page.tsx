import Link from 'next/link';
import { InvitationForm } from '@/modules/workspaces/presentation/family-forms';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold">Приглашение в семью</h1>
      <p>Приглашение доступно только аккаунту с указанной в письме почтой.</p>
      {token ? (
        <InvitationForm secret={token} />
      ) : (
        <p role="alert">Ссылка недействительна.</p>
      )}
      <Link className="underline" href="/families">
        Перейти к семьям
      </Link>
    </>
  );
}
