'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { goalInput, type GoalDto } from '../domain/reserve';
import { reserveAction } from './reserve-actions';
import { SavingsAccountPicker } from './savings-account-picker';
import type { SavingsAccountOption } from '../domain/savings-account';
export function ReserveForm({
  workspaceId,
  goal,
  accounts,
  locale = 'ru-RU',
}: {
  workspaceId: string;
  goal?: GoalDto;
  accounts: SavingsAccountOption[];
  locale?: string;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      name: goal?.name ?? '',
      description: goal?.description ?? '',
      accountId: goal?.accountId ?? '',
      type: goal?.type ?? 'ordinary',
      ordinaryTarget: goal?.ordinaryTarget ?? '',
      monthlyAmount: goal?.monthlyAmount ?? '',
      coverageMonths: goal?.coverageMonths ?? '12',
      targetDate: goal?.targetDate ?? '',
    },
  });
  const type = useWatch({ control: form.control, name: 'type' });
  const accountId = useWatch({ control: form.control, name: 'accountId' });
  const [message, setMessage] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ key: string; payload: string } | null>(null);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  useUnsavedChanges(dirty);
  const submit = async (command: 'create' | 'update' | 'archive') => {
    const values = form.getValues();
    const account = accounts.find((a) => a.id === values.accountId);
    const data =
      command === 'archive'
        ? { command, id: goal!.id, explicitConfirmation: true }
        : {
            command,
            ...(goal ? { id: goal.id } : {}),
            name: values.name,
            description: values.description,
            accountId: values.accountId,
            currency: account?.currency,
            type: values.type,
            targetDate: values.targetDate || undefined,
            ...(values.type === 'reserve'
              ? {
                  monthlyAmount: values.monthlyAmount,
                  coverageMonths: values.coverageMonths,
                }
              : { ordinaryTarget: values.ordinaryTarget }),
          };
    const parsed = goalInput.safeParse(data);
    if (!parsed.success) {
      setMessage('Проверьте название, счёт, суммы и дату цели.');
      form.setFocus(values.name ? 'accountId' : 'name');
      return;
    }
    if (
      command === 'archive' &&
      !window.confirm('Архивировать цель? Счёт и деньги сохранятся.')
    )
      return;
    const payload = JSON.stringify(parsed.data);
    if (pending.current && pending.current.payload !== payload) {
      setMessage(
        'Повторите предыдущую отправку с теми же данными или обновите страницу.',
      );
      return;
    }
    pending.current ??= { key: crypto.randomUUID(), payload };
    try {
      const result = await reserveAction(
        {
          workspaceId,
          operationKey: pending.current.key,
          expectedVersion: goal?.version,
        },
        parsed.data,
      );
      if (result.status === 'success') {
        pending.current = null;
        form.reset(goal ? values : undefined);
        setMessage(
          command === 'archive' ? 'Цель архивирована.' : 'Цель сохранена.',
        );
        router.refresh();
      } else {
        if (result.status !== 'unavailable') pending.current = null;
        setMessage(
          result.status === 'conflict'
            ? 'Цель изменилась или счёт уже занят активной целью. Обновите страницу.'
            : result.status === 'forbidden'
              ? 'Нет доступа к изменению цели.'
              : 'Не удалось сохранить цель. Повторите попытку.',
        );
      }
    } catch {
      setMessage('Не удалось сохранить. Повторите отправку с теми же данными.');
    }
  };
  return (
    <form
      aria-label={goal ? 'Изменить цель' : 'Новая цель'}
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(() => submit(goal ? 'update' : 'create'))(event);
      }}
    >
      <fieldset
        disabled={!form.formState.isReady || form.formState.isSubmitting}
        className="grid gap-3"
      >
        <label>
          Название цели
          <input
            className="block w-full rounded border bg-background p-2"
            {...form.register('name')}
          />
        </label>
        <label>
          Описание цели
          <textarea
            className="block w-full rounded border bg-background p-2"
            {...form.register('description')}
          />
        </label>
        <SavingsAccountPicker
          workspaceId={workspaceId}
          accounts={accounts}
          value={accountId}
          currentAccountId={goal?.accountId}
          registration={form.register('accountId')}
          locale={locale}
        />
        <label>
          Тип цели
          <select
            className="block w-full rounded border bg-background p-2"
            {...form.register('type')}
          >
            <option value="ordinary">Обычная цель</option>
            <option value="reserve">Резервный фонд</option>
          </select>
        </label>
        {type === 'reserve' ? (
          <>
            <label>
              Ежемесячное обязательство
              <input
                className="block w-full rounded border bg-background p-2"
                inputMode="decimal"
                readOnly={!!goal?.linkedObligationId}
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
            <p>Нулевое обязательство сохраняет фонд без расчёта покрытия.</p>
          </>
        ) : (
          <label>
            Целевая сумма
            <input
              className="block w-full rounded border bg-background p-2"
              inputMode="decimal"
              {...form.register('ordinaryTarget')}
            />
          </label>
        )}
        <label>
          Желаемая дата (необязательно)
          <input
            className="block w-full rounded border bg-background p-2"
            type="date"
            {...form.register('targetDate')}
          />
        </label>
        <Button type="submit">
          {form.formState.isSubmitting
            ? 'Сохраняем…'
            : goal
              ? 'Сохранить цель'
              : 'Создать цель'}
        </Button>
        {goal && (
          <Button
            type="button"
            onClick={() => {
              void form.handleSubmit(() => submit('archive'))();
            }}
          >
            Архивировать цель
          </Button>
        )}
      </fieldset>
      {message && (
        <p ref={status} tabIndex={-1} role="status">
          {message}
        </p>
      )}
    </form>
  );
}
