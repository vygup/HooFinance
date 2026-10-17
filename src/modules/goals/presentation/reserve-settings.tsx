'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { GoalDto } from '../domain/reserve';
import { reserveAdjustmentInput } from '../domain/reserve-adjustment';
import { reserveAdjustmentAction } from './reserve-adjustment-actions';
export function ReserveSettings({
  workspaceId,
  goal,
}: {
  workspaceId: string;
  goal: GoalDto;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      monthlyAmount: goal.monthlyAmount ?? '',
      coverageMonths: goal.coverageMonths ?? '12',
    },
  });
  const [message, setMessage] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ key: string; payload: string } | null>(null);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  useUnsavedChanges(dirty);
  return (
    <form
      aria-label="Настройки резерва"
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          const parsed = reserveAdjustmentInput.safeParse({
            ...values,
            command: 'adjustReserve',
            goalId: goal.id,
          });
          if (!parsed.success) {
            setMessage('Проверьте сумму и целое положительное число месяцев.');
            form.setFocus(
              parsed.error.issues[0]?.path[0] === 'coverageMonths'
                ? 'coverageMonths'
                : 'monthlyAmount',
            );
            return;
          }
          const payload = JSON.stringify(parsed.data);
          if (pending.current && pending.current.payload !== payload) {
            setMessage(
              'Повторите предыдущую отправку с теми же данными или обновите страницу.',
            );
            return;
          }
          pending.current ??= { key: crypto.randomUUID(), payload };
          try {
            const result = await reserveAdjustmentAction(
              {
                workspaceId,
                operationKey: pending.current.key,
                expectedVersion: goal.version,
              },
              parsed.data,
            );
            if (result.status === 'success') {
              pending.current = null;
              form.reset(values);
              setMessage('Настройки резерва сохранены.');
              router.refresh();
            } else {
              if (result.status !== 'unavailable') pending.current = null;
              setMessage(
                result.status === 'conflict'
                  ? 'Резерв изменился. Обновите страницу.'
                  : result.status === 'forbidden'
                    ? 'Нет доступа к изменению резерва.'
                    : result.status === 'validation'
                      ? 'Проверьте сумму и число месяцев.'
                      : 'Не удалось сохранить. Повторите отправку с теми же данными.',
              );
            }
          } catch {
            setMessage(
              'Не удалось сохранить. Повторите отправку с теми же данными.',
            );
          }
        })(event);
      }}
    >
      <fieldset
        className="grid gap-3"
        disabled={!form.formState.isReady || form.formState.isSubmitting}
      >
        <legend>Настройки резерва</legend>
        <label>
          Ежемесячное обязательство
          <input
            className="block w-full rounded border bg-background p-2"
            inputMode="decimal"
            readOnly={!!goal.linkedObligationId}
            {...form.register('monthlyAmount')}
          />
        </label>
        <label>
          Месяцы покрытия
          <input
            className="block w-full rounded border bg-background p-2"
            inputMode="numeric"
            {...form.register('coverageMonths')}
          />
        </label>
        <p>
          Нулевое обязательство сохраняет фонд без расчёта покрытия. Изменение
          настроек не меняет деньги на счёте.
        </p>
        <Button type="submit">
          {form.formState.isSubmitting
            ? 'Сохраняем…'
            : 'Сохранить настройки резерва'}
        </Button>
      </fieldset>
      {message && (
        <p ref={status} tabIndex={-1} role="status">
          {message}
        </p>
      )}
    </form>
  );
}
