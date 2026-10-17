'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  registrationInput,
  loginInput,
  recoveryInput,
  resetInput,
  profileInput,
} from '../domain/registration';
import type { IdentityResult } from './action-result';
const schemas = {
  register: registrationInput,
  login: loginInput,
  recovery: recoveryInput,
  reset: resetInput,
  profile: profileInput,
};
type Mode = keyof typeof schemas;
type Field = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  hint?: string;
};
const name: Field = {
  name: 'name',
  label: 'Отображаемое имя',
  autoComplete: 'nickname',
};
const email: Field = {
  name: 'email',
  label: 'Электронная почта',
  type: 'email',
  autoComplete: 'email',
};
const password: Field = {
  name: 'password',
  label: 'Пароль',
  type: 'password',
  autoComplete: 'current-password',
};
const fields: Record<Mode, Field[]> = {
  register: [
    name,
    email,
    { ...password, autoComplete: 'new-password', hint: 'От 8 до 128 символов' },
  ],
  login: [email, password],
  recovery: [email],
  reset: [
    {
      name: 'newPassword',
      label: 'Новый пароль',
      type: 'password',
      autoComplete: 'new-password',
      hint: 'От 8 до 128 символов',
    },
  ],
  profile: [
    name,
    { name: 'locale', label: 'Локаль', hint: 'Например, ru-RU или en-US' },
    {
      name: 'timezone',
      label: 'Часовой пояс',
      hint: 'Например, Europe/Moscow или Asia/Tokyo',
    },
  ],
};
const titles: Record<Mode, string> = {
  register: 'Создать аккаунт',
  login: 'Войти',
  recovery: 'Отправить ссылку',
  reset: 'Сохранить новый пароль',
  profile: 'Сохранить профиль',
};
export function IdentityForm({
  mode,
  action,
  initial = {},
  nativeAction,
}: {
  mode: Mode;
  action: (input: unknown) => Promise<IdentityResult>;
  initial?: Record<string, string>;
  nativeAction?: (formData: FormData) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Record<string, string>>({
    defaultValues: {
      ...Object.fromEntries(fields[mode].map((field) => [field.name, ''])),
      ...initial,
    },
  });
  const [result, setResult] = useState<IdentityResult>();
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (result) notice.current?.focus();
  }, [result]);
  useUnsavedChanges(isDirty && result?.status !== 'success');
  const showErrors = (values: Record<string, string[]>) => {
    for (const [field, messages] of Object.entries(values))
      setError(field, { message: messages[0] ?? 'Проверьте значение поля' });
    const first = fields[mode].find((field) => values[field.name]);
    if (first) setFocus(first.name);
  };
  return (
    <form
      action={nativeAction}
      method={nativeAction ? undefined : 'post'}
      noValidate
      onChange={() => {
        if (result) setResult(undefined);
      }}
      className="grid gap-5"
      aria-busy={isSubmitting}
      onSubmit={handleSubmit(async (values) => {
        setResult(undefined);
        const parsed = schemas[mode].safeParse(values);
        if (!parsed.success) {
          const messages: Record<string, string[]> = {};
          for (const issue of parsed.error.issues)
            (messages[issue.path.join('.')] ??= []).push(issue.message);
          showErrors(messages);
          return;
        }
        let next: IdentityResult;
        try {
          next = await action(parsed.data);
        } catch {
          next = {
            status: 'unavailable',
            message:
              'Нет связи с сервером. Введённые данные сохранены. Попробуйте ещё раз.',
          };
        }
        setResult(next);
        if (next.fieldErrors) showErrors(next.fieldErrors);
        if (next.status === 'success') {
          if (mode === 'register' || mode === 'login') {
            window.location.replace('/dashboard');

            return;
          }
          if (mode === 'reset')
            reset({ token: initial.token ?? '', newPassword: '' });
          if (next.profile) {
            const { name, locale, timezone, version } = next.profile;
            reset({ name, locale, timezone, expectedVersion: version });
          }
        }
      })}
    >
      {mode === 'reset' && <input type="hidden" {...register('token')} />}
      {mode === 'profile' && (
        <input type="hidden" {...register('expectedVersion')} />
      )}
      {fields[mode].map((field) => (
        <div key={field.name} className="grid gap-2">
          <label htmlFor={field.name} className="font-medium">
            {field.label}
          </label>
          <input
            id={field.name}
            type={field.type ?? 'text'}
            autoComplete={field.autoComplete}
            required
            disabled={isSubmitting}
            aria-invalid={!!errors[field.name]}
            aria-describedby={`${field.name}-help ${field.name}-error`}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            {...register(field.name)}
          />
          <p
            id={`${field.name}-help`}
            className="text-sm text-muted-foreground"
          >
            {field.hint}
          </p>
          <p id={`${field.name}-error`} className="text-sm text-destructive">
            {errors[field.name]?.message}
          </p>
        </div>
      ))}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Подождите…' : titles[mode]}
      </Button>
      {result && (
        <p
          ref={notice}
          tabIndex={-1}
          role={result.status === 'success' ? 'status' : 'alert'}
          className="rounded-md border p-3 leading-relaxed"
        >
          {result.status === 'success'
            ? mode === 'recovery'
              ? 'Если эта почта зарегистрирована, мы отправили ссылку для восстановления. Ссылка действует один час.'
              : mode === 'reset'
                ? 'Пароль изменён. Войдите с новым паролем.'
                : mode === 'register' || mode === 'login'
                  ? 'Вход выполнен. Открываем личный кабинет…'
                  : 'Профиль сохранён.'
            : (result.message ??
              (result.status === 'unauthorized'
                ? 'Сессия истекла. Войдите снова.'
                : 'Проверьте значения полей.'))}
        </p>
      )}
      {result?.status === 'conflict' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (
              window.confirm('Заменить введённые данные актуальным профилем?')
            )
              window.location.reload();
          }}
        >
          Загрузить актуальный профиль
        </Button>
      )}
      {mode === 'reset' && (
        <Link
          className="underline underline-offset-4"
          href={result?.status === 'success' ? '/login' : '/forgot-password'}
        >
          {result?.status === 'success'
            ? 'Перейти ко входу'
            : 'Запросить новую ссылку'}
        </Link>
      )}
    </form>
  );
}
