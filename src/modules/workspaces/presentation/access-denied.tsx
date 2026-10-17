'use client';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { privacyInput } from '../domain/privacy-input';
import { checkPrivacyAction } from './privacy-actions';
export function AccessDenied({ workspaceId }: { workspaceId: string }) {
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = useForm();
  const [message, setMessage] = useState('Нет доступа к этому пространству.');
  const status = useRef<HTMLParagraphElement>(null);
  return (
    <section
      aria-label="Доступ к пространству"
      className="grid gap-4 rounded border p-5"
    >
      <h1 className="text-2xl font-semibold">Доступ ограничен</h1>
      <p ref={status} tabIndex={-1} role="alert">
        {message}
      </p>
      <a className="underline" href="/dashboard">
        Вернуться в личное пространство
      </a>
      <form
        onSubmit={(event) => {
          void handleSubmit(async () => {
            const input = privacyInput.safeParse({ workspaceId });
            try {
              const result = input.success
                ? await checkPrivacyAction(input.data)
                : { status: 'forbidden' };
              if (result.status === 'success') {
                window.location.reload();
                return;
              }
              setMessage(
                result.status === 'unavailable'
                  ? 'Не удалось проверить доступ. Попробуйте ещё раз.'
                  : 'Нет доступа к этому пространству.',
              );
            } catch {
              setMessage('Не удалось проверить доступ. Попробуйте ещё раз.');
            }
            status.current?.focus();
          })(event);
        }}
      >
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Проверяем доступ…' : 'Проверить доступ снова'}
        </Button>
      </form>
    </section>
  );
}
