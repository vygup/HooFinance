'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { CategoryDto } from '@/modules/categories/domain/expenses';
import { budgetInput, type BudgetPlan } from '../domain/monthly-budget';
import { monthlyBudgetAction } from './monthly-budget-actions';
export function MonthlyBudgetForm({
  workspaceId,
  month,
  currency,
  budget,
  categories,
}: {
  workspaceId: string;
  month: string;
  currency: string;
  budget: BudgetPlan | null;
  categories: CategoryDto[];
}) {
  const router = useRouter();
  const editable = categories.filter(
    (c) =>
      !c.archived || budget?.categoryLimits.some((l) => l.categoryId === c.id),
  );
  const form = useForm({
    defaultValues: {
      plannedIncome: budget?.plannedIncome ?? '0',
      limits: editable.map((c) => ({
        categoryId: c.id,
        amount:
          budget?.categoryLimits.find((l) => l.categoryId === c.id)?.amount ??
          '',
      })),
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
      aria-label="План бюджета"
      className="grid gap-4 rounded-lg border p-5"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          const parsed = budgetInput.safeParse({
            month,
            currency,
            plannedIncome: values.plannedIncome,
            categoryLimits: values.limits.filter((l) => l.amount !== ''),
          });
          if (!parsed.success) {
            setMessage(
              'Проверьте суммы: нужны неотрицательные числа с масштабом валюты.',
            );
            form.setFocus('plannedIncome');
            return;
          }
          const payload = JSON.stringify(parsed.data);
          if (pending.current && pending.current.payload !== payload) {
            setMessage(
              'Сначала повторите предыдущую отправку без изменения данных или обновите страницу.',
            );
            return;
          }
          pending.current ??= { key: crypto.randomUUID(), payload };
          try {
            const result = await monthlyBudgetAction(
              {
                workspaceId,
                operationKey: pending.current.key,
                expectedVersion: budget?.version,
              },
              parsed.data,
            );
            if (result.status === 'success') {
              pending.current = null;
              form.reset(values);
              setMessage('Бюджет сохранён.');
              router.refresh();
            } else {
              if (result.status !== 'unavailable') pending.current = null;
              setMessage(
                result.status === 'conflict'
                  ? 'Бюджет изменился. Обновите страницу перед сохранением.'
                  : result.status === 'forbidden'
                    ? 'Нет доступа к изменению бюджета.'
                    : 'Не удалось сохранить бюджет. Повторите попытку.',
              );
            }
          } catch {
            setMessage(
              'Не удалось сохранить бюджет. Повторите отправку с теми же данными.',
            );
          }
        })(event);
      }}
    >
      <h2 className="text-xl font-medium">План · {currency}</h2>
      <fieldset
        disabled={!form.formState.isReady || form.formState.isSubmitting}
        className="grid gap-3"
      >
        <label>
          Плановый доход
          <input
            className="block w-full rounded border bg-background p-2"
            inputMode="decimal"
            {...form.register('plannedIncome')}
          />
        </label>
        <p>Пустое поле — без лимита. Ноль — утверждённый нулевой лимит.</p>
        {editable.map((c, i) => (
          <label key={c.id}>
            Лимит: {c.name}
            {c.archived ? ' (архивная)' : ''}
            <input
              className="block w-full rounded border bg-background p-2"
              inputMode="decimal"
              {...form.register(`limits.${i}.amount`)}
            />
          </label>
        ))}
        {editable.length === 0 && (
          <p>Добавьте категории расходов в разделе счетов.</p>
        )}
        <Button type="submit">
          {form.formState.isSubmitting ? 'Сохраняем…' : 'Сохранить бюджет'}
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
