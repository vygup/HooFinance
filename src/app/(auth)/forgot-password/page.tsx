import { IdentityForm } from '@/modules/identity/presentation/identity-form';
import { recoverPasswordAction } from '@/modules/identity/presentation/password-recovery-actions';
export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Восстановление пароля</h1>
      <IdentityForm mode="recovery" action={recoverPasswordAction} />
    </>
  );
}
