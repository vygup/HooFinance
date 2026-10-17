'use server';
import { registrationInput } from '../application/registration-input';
import { register } from '../application/registration';
import { identityTransport } from './action-transport';
export async function registerAction(input: unknown) {
  return identityTransport(
    registrationInput,
    input,
    async (data, headers) => {
      const result = await register(headers, data);
      if (!(result instanceof Response))
        throw new Error('INVALID_REGISTRATION');
      return result;
    },
    'Не удалось зарегистрироваться. Проверьте данные или перейдите ко входу.',
  );
}

/** Progressive enhancement: a native POST must register, never put credentials in a GET URL. */
export async function registerFormAction(formData: FormData): Promise<void> {
  const result = await registerAction({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  // redirect throws; keep it outside the transport's error handler.
  const { redirect } = await import('next/navigation');
  if (result.status === 'success') redirect('/dashboard');
  redirect('/register?error=registration');
}
