'use server';
import { getAuth } from '@/server/auth/auth';
import { loginInput } from '../application/registration-input';
import { identityTransport } from './action-transport';
export async function loginAction(input: unknown) {
  return identityTransport(
    loginInput,
    input,
    (body, headers) =>
      getAuth().api.signInEmail({ body, headers, asResponse: true }),
    'Неверная почта или пароль.',
  );
}
