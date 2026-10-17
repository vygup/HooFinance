import { beforeEach, expect, test, vi } from 'vitest';
const transport = vi.hoisted(() => ({
  signup: vi.fn(),
  signin: vi.fn(),
  signout: vi.fn(),
  recovery: vi.fn(),
  reset: vi.fn(),
  session: vi.fn(),
  cookie: vi.fn(),
  handler: vi.fn(),
}));
vi.mock('@/server/auth/auth', () => ({
  getAuth: () => ({
    handler: transport.handler,
    api: {
      signUpEmail: transport.signup,
      signInEmail: transport.signin,
      signOut: transport.signout,
      requestPasswordReset: transport.recovery,
      resetPassword: transport.reset,
      getSession: transport.session,
    },
  }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'http://localhost:3000' }),
  cookies: async () => ({ set: transport.cookie }),
}));
import { registerAction } from '@/modules/identity/presentation/registration-actions';
import { loginAction } from '@/modules/identity/presentation/login-actions';
import { logoutAction } from '@/modules/identity/presentation/logout-actions';
import { recoverPasswordAction } from '@/modules/identity/presentation/password-recovery-actions';
import { resetPasswordAction } from '@/modules/identity/presentation/password-reset-actions';
import {
  personalDashboard,
  readProfile,
} from '@/modules/identity/application/registration';
beforeEach(() => {
  for (const mock of Object.values(transport)) mock.mockReset();
});
import {
  registrationInput,
  loginInput,
  recoveryInput,
  resetInput,
  profileInput,
} from '@/modules/identity/domain/registration';
const valid = {
  name: ' Анна ',
  email: ' Anna+home@Example.org ',
  password: 'StrongPassword123!',
};
test('Регистрация нормализует почту и имя без изменения пароля или plus-части', () => {
  expect(registrationInput.parse(valid)).toEqual({
    ...valid,
    name: 'Анна',
    email: 'anna+home@example.org',
  });
  for (const input of [
    { ...valid, email: 'bad' },
    { ...valid, name: ' ' },
    { ...valid, password: 'short' },
    { ...valid, workspaceId: 'foreign' },
  ])
    expect(registrationInput.safeParse(input).success).toBe(false);
});
test('Вход и восстановление не требуют session или workspace', () => {
  expect(
    loginInput.parse({ email: valid.email, password: valid.password }).email,
  ).toBe('anna+home@example.org');
  expect(recoveryInput.parse({ email: valid.email })).toEqual({
    email: 'anna+home@example.org',
  });
  expect(
    resetInput.safeParse({ token: '', newPassword: valid.password }).success,
  ).toBe(false);
  expect(
    resetInput.safeParse({ token: 'opaque', newPassword: valid.password })
      .success,
  ).toBe(true);
});
test('Профиль валидирует locale/timezone и точную bigint-версию, запрещает смену почты/actor', () => {
  const profile = {
    name: 'Анна',
    locale: 'ru-RU',
    timezone: 'Europe/Moscow',
    expectedVersion: '9007199254740993',
  };
  expect(profileInput.parse(profile)).toEqual(profile);
  for (const input of [
    { ...profile, timezone: 'Mars/Olympus' },
    { ...profile, locale: 'invalid_locale' },
    { ...profile, expectedVersion: '0' },
    { ...profile, expectedVersion: 'abc' },
    { ...profile, expectedVersion: '9223372036854775807' },
    { ...profile, timezone: '+03:00' },
    { ...profile, expectedVersion: 1 },
    { ...profile, email: 'other@example.org' },
    { ...profile, userId: 'other' },
  ])
    expect(profileInput.safeParse(input).success).toBe(false);
});

test('Signup transport публикует cookie только после успешного provisioning, без auth secret в DTO; повтор/ошибка не создают session', async () => {
  transport.signup.mockResolvedValueOnce(
    Response.json(
      { token: 'private-secret' },
      {
        headers: {
          'set-cookie':
            'better-auth.session_token=opaque; Path=/; HttpOnly; SameSite=Lax',
        },
      },
    ),
  );
  expect(await registerAction(valid)).toEqual({ status: 'success' });
  expect(transport.cookie).toHaveBeenCalledWith(
    'better-auth.session_token',
    'opaque',
    expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
  );
  transport.cookie.mockClear();
  transport.signup.mockResolvedValueOnce(
    Response.json(
      { code: 'USER_ALREADY_EXISTS', privateData: 'secret' },
      { status: 422 },
    ),
  );
  const duplicate = await registerAction(valid);
  expect(duplicate.status).toBe('error');
  expect(JSON.stringify(duplicate)).not.toContain('secret');
  expect(transport.cookie).not.toHaveBeenCalled();
  transport.signup.mockResolvedValueOnce(new Response(null, { status: 500 }));
  expect((await registerAction(valid)).status).toBe('error');
  expect(transport.cookie).not.toHaveBeenCalled();
});
test('Sign-in/out/reset используют Better Auth без финансового envelope; ошибки credentials и token безопасны', async () => {
  transport.signin.mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect(
    await loginAction({ email: valid.email, password: valid.password }),
  ).toMatchObject({ status: 'error', message: 'Неверная почта или пароль.' });
  transport.signout.mockResolvedValueOnce(
    new Response(null, {
      status: 200,
      headers: {
        'set-cookie': 'better-auth.session_token=; Path=/; HttpOnly; Max-Age=0',
      },
    }),
  );
  expect(await logoutAction()).toEqual({ status: 'success' });
  expect(transport.cookie).toHaveBeenCalledWith(
    'better-auth.session_token',
    '',
    expect.objectContaining({ maxAge: 0, httpOnly: true }),
  );
  transport.recovery.mockImplementation(async () =>
    Response.json({ status: true }),
  );
  const known = await recoverPasswordAction({ email: valid.email });
  expect(await recoverPasswordAction({ email: 'unknown@example.org' })).toEqual(
    known,
  );
  expect(known).toEqual({ status: 'success' });
  transport.reset.mockResolvedValueOnce(new Response(null, { status: 400 }));
  expect(
    await resetPasswordAction({
      token: 'expired',
      newPassword: valid.password,
    }),
  ).toMatchObject({
    status: 'error',
    message: expect.stringContaining('Ссылка недействительна'),
  });
});
test('Без session чтение профиля и личных данных отклоняется до запросов финансовых таблиц', async () => {
  transport.session.mockResolvedValue(null);
  await expect(personalDashboard(new Headers())).rejects.toThrow(
    'UNAUTHORIZED',
  );
  await expect(readProfile(new Headers())).rejects.toThrow('UNAUTHORIZED');
});

test('Auth Route Handler сохраняет redirect восстановления с пустым JSON body и no-store', async () => {
  const { GET } = await import('@/app/api/auth/[...all]/route');
  transport.handler.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: {
        'content-type': 'application/json',
        location: 'http://localhost:3000/reset-password?error=INVALID_TOKEN',
      },
    }),
  );
  const response = await GET(
    new Request(
      'http://localhost:3000/api/auth/reset-password/expired?callbackURL=/reset-password',
    ),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toContain(
    '/reset-password?error=INVALID_TOKEN',
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.text()).toBe('');
});

test('Dev logging не записывает URL восстановления или аргументы Server Actions', async () => {
  const { default: config } = await import('../../next.config');
  expect(config.logging).toMatchObject({
    incomingRequests: false,
    serverFunctions: false,
  });
});
