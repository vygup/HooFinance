import { IdentityForm } from '@/modules/identity/presentation/identity-form';
import { loginAction } from '@/modules/identity/presentation/login-actions';
export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Вход</h1>
      <IdentityForm mode="login" action={loginAction} />
    </>
  );
}
