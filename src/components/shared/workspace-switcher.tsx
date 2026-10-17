'use client';
import {
  useUnsavedChanges,
  confirmUnsavedNavigation,
  permitDocumentNavigation,
  resetNavigationPermission,
} from './unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  switchingInput,
  type SpaceOption,
} from '@/modules/workspaces/domain/switching-input';
import { switchingTarget } from '@/modules/workspaces/domain/switching';
import { switchSpaceAction } from '@/modules/workspaces/presentation/switching-actions';
export function WorkspaceSwitcher({
  active,
  deleted,
}: {
  active: SpaceOption[];
  deleted: SpaceOption[];
}) {
  const pathname = usePathname();
  const currentId = /^\/w\/([^/]+)/.exec(pathname)?.[1] ?? '';
  const current = active.find((s) => s.id === currentId);
  const [message, setMessage] = useState('');
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  useEffect(() => {
    resetNavigationPermission();
  }, [pathname]);
  const form = useForm({ defaultValues: { workspaceId: currentId } });
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = form;
  useUnsavedChanges(false);
  const { reset } = form;
  useEffect(() => {
    reset({ workspaceId: currentId });
  }, [currentId, reset]);
  return (
    <section
      aria-label="Переключение пространств"
      className="grid gap-3 border-b py-4"
    >
      {current && (
        <p aria-label="Активное пространство">
          {current.name} · {current.kind === 'personal' ? 'личное' : 'семейное'}
        </p>
      )}
      <form
        aria-label="Выбор пространства"
        className="flex flex-wrap items-end gap-3"
        onSubmit={handleSubmit(async (values) => {
          setMessage('');
          const href = switchingTarget(
            values.workspaceId,
            deleted.some((s) => s.id === values.workspaceId),
            pathname,
          );
          if (href === location.pathname) return;
          const section =
            /^\/w\/[^/]+\/(accounts|budget|goals|operations)$/.exec(
              href,
            )?.[1] ?? 'accounts';
          const parsed = switchingInput.safeParse({ ...values, section });
          if (!parsed.success) {
            setMessage('Выберите доступное пространство.');
            return;
          }
          if (!confirmUnsavedNavigation()) return;
          try {
            const result = await switchSpaceAction(parsed.data);
            if (result.status !== 'success') {
              setMessage(
                result.status === 'forbidden'
                  ? 'Пространство больше недоступно. Обновите страницу.'
                  : 'Не удалось переключить пространство. Попробуйте ещё раз.',
              );
              return;
            }
            // A document navigation clears scoped client state and the Router cache.
            // Already confirmed here; disable the duplicate unload prompt only for this navigation.
            permitDocumentNavigation();
            window.location.assign(result.data.href);
          } catch {
            setMessage(
              'Не удалось переключить пространство. Попробуйте ещё раз.',
            );
          }
        })}
      >
        <label className="grid gap-1">
          Выберите пространство
          <select
            {...register('workspaceId')}
            disabled={isSubmitting}
            className="max-w-full rounded border bg-background p-2"
          >
            <option value="">Выберите пространство</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.kind === 'personal' ? 'личное' : 'семейное'}
              </option>
            ))}
            {deleted.length > 0 && (
              <optgroup label="Удалённые · только история">
                {deleted.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · удалённое
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Переключение…' : 'Переключить пространство'}
        </Button>
        <p hidden={!message} ref={feedback} tabIndex={-1} role="status">
          {message}
        </p>
      </form>
    </section>
  );
}
