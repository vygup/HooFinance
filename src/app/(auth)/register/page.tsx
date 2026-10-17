import { IdentityForm } from '@/modules/identity/presentation/identity-form';
import {
  registerAction,
  registerFormAction,
} from '@/modules/identity/presentation/registration-actions';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const failed = (await searchParams).error === 'registration';
  return (
    <>
      <h1 className="text-3xl font-semibold">Регистрация</h1>
      {failed && (
        <p role="alert">
          Не удалось зарегистрироваться. Проверьте данные или перейдите ко
          входу.
        </p>
      )}
      <IdentityForm
        mode="register"
        action={registerAction}
        nativeAction={registerFormAction}
      />
    </>
  );
}
