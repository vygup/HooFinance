'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { SavingsPlanDto } from '../domain/savings-plan';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import { savingsPlanInput } from '../domain/savings-plan';
import {
  savingsPlanAction,
  savingsPlanPreviewAction,
} from './savings-plan-actions';
export function SavingsPlan({
  workspaceId,
  goal,
  currency,
  locale,
}: {
  workspaceId: string;
  goal: SavingsPlanDto;
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      monthlyContribution: goal.monthlyContribution ?? '',
      anchorDate: goal.anchorDate,
    },
  });
  const dirty = form.formState.isDirty;
  const [preview, setPreview] = useState<{
    key: string;
    projection?: SavingsPlanDto['projection'];
    error?: string;
  } | null>(null);
  const values = useWatch({ control: form.control });
  const previewKey = JSON.stringify({ values, source: goal.projection });
  useEffect(() => {
    if (!dirty) return;
    let active = true;
    const timer = setTimeout(() => {
      const parsed = savingsPlanInput.safeParse({
        ...JSON.parse(previewKey).values,
        monthlyContribution:
          JSON.parse(previewKey).values.monthlyContribution || undefined,
        command: 'configureSavings',
        goalId: goal.goalId,
      });
      if (!parsed.success) {
        setPreview({
          key: previewKey,
          error: 'Проверьте сумму и дату первого взноса.',
        });
        return;
      }
      void savingsPlanPreviewAction(workspaceId, parsed.data)
        .then((result) => {
          if (active)
            setPreview(
              result.status === 'success'
                ? { key: previewKey, projection: result.data }
                : {
                    key: previewKey,
                    error:
                      'Не удалось рассчитать. Проверьте данные и доступ к пространству.',
                  },
            );
        })
        .catch(() => {
          if (active)
            setPreview({
              key: previewKey,
              error: 'Не удалось рассчитать. Попробуйте ещё раз.',
            });
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dirty, previewKey, goal.goalId, workspaceId]);
  const projection =
    dirty && preview?.key === previewKey && preview.projection
      ? preview.projection
      : goal.projection;
  const [message, setMessage] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ key: string; payload: string } | null>(null);
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  useUnsavedChanges(dirty);
  return (
    <form
      aria-label="План накоплений"
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          const parsed = savingsPlanInput.safeParse({
            ...values,
            monthlyContribution: values.monthlyContribution || undefined,
            command: 'configureSavings',
            goalId: goal.goalId,
          });
          if (!parsed.success) {
            setMessage('Проверьте сумму и дату первого взноса.');
            form.setFocus(
              parsed.error.issues[0]?.path[0] === 'anchorDate'
                ? 'anchorDate'
                : 'monthlyContribution',
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
            const result = await savingsPlanAction(
              {
                workspaceId,
                operationKey: pending.current.key,
                expectedVersion: goal.configured ? goal.version : undefined,
              },
              parsed.data,
            );
            if (result.status === 'success') {
              pending.current = null;
              form.reset(values);
              setMessage('План сохранён.');
              router.refresh();
            } else {
              if (result.status !== 'unavailable') pending.current = null;
              setMessage(
                result.status === 'conflict'
                  ? 'План изменился. Обновите страницу.'
                  : result.status === 'forbidden'
                    ? 'Нет доступа к изменению плана.'
                    : result.status === 'validation'
                      ? 'Проверьте сумму и дату первого взноса.'
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
      {dirty && (
        <p aria-live="polite">
          {preview?.key === previewKey
            ? (preview.error ?? 'Предпросмотр · изменения ещё не сохранены')
            : 'Рассчитываем изменения…'}
        </p>
      )}
      <p>
        Регулярное число месяца: {goal.anchorDay}. Следующий взнос:{' '}
        {formatFinancialDate(projection.nextDate, locale)}
      </p>
      <p>Осталось взносов до срока: {projection.count}</p>
      {projection.recommendation !== null && (
        <p>
          Рекомендуемое пополнение:{' '}
          {formatMoney(projection.recommendation, currency, locale)}
        </p>
      )}
      {projection.state === 'no_deadline' && <p>Укажите желаемую дату цели.</p>}
      {projection.state === 'expired' && <p>Срок цели истёк.</p>}
      {['expired', 'no_dates'].includes(projection.state) && (
        <p>
          Нет допустимых дат взносов. Нужно разовое пополнение или изменение
          расписания.
        </p>
      )}
      {projection.state === 'no_obligation' && (
        <p>Обязательство отсутствует — пополнение не требуется.</p>
      )}
      {projection.state === 'reached' && (
        <p>Цель достигнута — пополнение не требуется.</p>
      )}
      {projection.forecastDate ? (
        <p>
          Прогноз достижения:{' '}
          {formatFinancialDate(projection.forecastDate, locale)}
          {projection.late && ' · позже желаемого срока'}
        </p>
      ) : (
        <p>Прогнозная дата отсутствует.</p>
      )}
      {projection.forecastOutOfRange && (
        <p>Прогноз выходит за диапазон календаря.</p>
      )}
      <fieldset
        className="grid gap-3"
        disabled={!form.formState.isReady || form.formState.isSubmitting}
      >
        <legend>План накоплений</legend>
        <label>
          Ежемесячное пополнение
          <input
            className="block w-full rounded border bg-background p-2"
            inputMode="decimal"
            {...form.register('monthlyContribution')}
          />
        </label>
        <label>
          Первый предстоящий взнос
          <input
            className="block w-full rounded border bg-background p-2"
            type="date"
            min={
              goal.configured && goal.anchorDate < goal.today
                ? goal.anchorDate
                : goal.today
            }
            {...form.register('anchorDate')}
          />
        </label>
        <p>
          Прогноз предполагает неизменный план пополнений. План не создаёт
          операций; реальные переводы подтверждаются отдельно.
        </p>
        <Button type="submit">
          {form.formState.isSubmitting ? 'Сохраняем…' : 'Сохранить план'}
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
