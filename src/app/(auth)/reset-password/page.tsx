import Link from 'next/link';
import { IdentityForm } from '@/modules/identity/presentation/identity-form';
import { resetPasswordAction } from '@/modules/identity/presentation/password-reset-actions';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold">Новый пароль</h1>
      {params.error || !params.token ? (
        <>
          <p role="alert">Ссылка недействительна или срок её действия истёк.</p>
          <Link className="underline" href="/forgot-password">
            Запросить новую ссылку
          </Link>
        </>
      ) : (
        <IdentityForm
          mode="reset"
          action={resetPasswordAction}
          initial={{ token: params.token }}
        />
      )}
    </>
  );
}
