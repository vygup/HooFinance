'use server';
import { getAuth } from '@/server/auth/auth';
import { recoveryInput } from '../application/registration-input';
import { identityTransport } from './action-transport';
export async function recoverPasswordAction(input: unknown) {
  return identityTransport(
    recoveryInput,
    input,
    (data, headers) =>
      getAuth().api.requestPasswordReset({
        body: { ...data, redirectTo: '/reset-password' },
        headers,
        asResponse: true,
      }),
    'Не удалось запросить восстановление. Попробуйте позже.',
  );
}
