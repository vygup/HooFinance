'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import type { IncomeDto } from '../domain/income';
import { expenseInput } from '@/modules/categories/domain/expenses';
import { expenseAction } from './expense-actions';
import { incomeAction } from './income-actions';
import { formatMoney } from '@/shared/money/format';
import type { CommandResult } from '@/shared/contracts/commands';
type Fields = {
  accountId: string;
  amount: string;
  financialDate: string;
  categoryId: string;
  categoryName: string;
  description: string;
};
const inputClass = 'w-full rounded-md border bg-background px-3 py-2';
export function FinancialEntryForm({
  kind,
  workspaceId,
  accounts,
  categories,
  today,
  accountId = '',
  submitAction: customSubmit,
}: {
  kind: 'income' | 'expense';
  accountId?: string;
  submitAction?: typeof expenseAction;
  workspaceId: string;
  accounts: {
    id: string;
    name: string;
    currency: string;
  }[];
  categories: {
    id: string;
    name: string;
  }[];
  today: string;
}) {
  const text = useCallback(
    (value: string): string =>
      kind === 'income'
        ? value.replaceAll('расход', 'доход').replaceAll('Расход', 'Доход')
        : value,
    [kind],
  );
  const submitAction =
    customSubmit ?? (kind === 'income' ? incomeAction : expenseAction);
  const router = useRouter();
  const warningRef = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof expenseInput.parse> | null>(null);
  const [result, setResult] = useState<CommandResult<IncomeDto> | null>(null);
  const [invalidField, setInvalidField] = useState<keyof Fields | null>(null);
  const key = useRef<string | null>(null),
    feedback = useRef<HTMLDivElement>(null);
  const form = useForm<Fields>({
    defaultValues: {
      accountId,
      amount: '',
      financialDate: today,
      categoryId: categories.length ? '' : 'new',
      categoryName: '',
      description: '',
    },
  });
  const { isDirty, isSubmitting } = form.formState;
  const { setFocus } = form;
  useEffect(() => {
    if (!isSubmitting && invalidField && result?.status === 'validation')
      setFocus(invalidField);
  }, [isSubmitting, invalidField, result, setFocus]);
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  useEffect(() => {
    if (result?.status === 'confirmation_required') warningRef.current?.focus();
    else if (result && result.status !== 'validation')
      feedback.current?.focus();
  }, [result]);
  useUnsavedChanges(isDirty);
  return (
    <form
      aria-label={text('Новый расход')}
      className="grid gap-3 rounded-lg border p-5"
      onChange={() => {
        if (result?.status === 'confirmation_required') {
          setResult(null);
          pending.current = null;
        }
      }}
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          const parsed = expenseInput.safeParse({
            accountId: values.accountId,
            amount: values.amount,
            financialDate: values.financialDate,
            category:
              values.categoryId === 'new'
                ? { name: values.categoryName }
                : { id: values.categoryId },
            description: values.description,
          });
          if (!parsed.success) {
            const field = parsed.error.issues[0]?.path[0];
            const focus =
              field === 'category'
                ? values.categoryId === 'new'
                  ? 'categoryName'
                  : 'categoryId'
                : field;
            if (typeof focus === 'string' && focus in values) {
              setInvalidField(focus as keyof Fields);
            }
            setResult({ status: 'validation', fieldErrors: {} });
            return;
          }
          setInvalidField(null);
          pending.current = parsed.data;
          key.current ??= crypto.randomUUID();
          try {
            const r = await submitAction(
              { workspaceId, operationKey: key.current },
              parsed.data,
            );
            setResult(r);
            if (r.status === 'success') {
              key.current = null;
              form.reset({
                ...values,
                amount: '',
                description: '',
                categoryId: r.data.categoryId,
                categoryName: '',
              });
              router.refresh();
            }
            if (r.status === 'validation') {
              const field = Object.keys(r.fieldErrors)[0];
              if (field && field in values)
                setInvalidField(field as keyof Fields);
            }
          } catch {
            setResult({ status: 'unavailable' });
          }
        })(event);
      }}
    >
      <h2 className="text-xl font-medium">{text('Новый расход')}</h2>
      {accounts.length === 0 && (
        <p>{text('Создайте активный счёт, чтобы добавить расход.')}</p>
      )}
      <fieldset
        disabled={
          !form.formState.isReady || isSubmitting || accounts.length === 0
        }
        className="grid min-w-0 gap-3"
      >
        <label>
          {text('Счёт расхода')}
          <select className={inputClass} {...form.register('accountId')}>
            <option value="">Выберите счёт</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {text('Валюта расхода совпадает с валютой выбранного счёта.')}
        </p>
        <label>
          {text('Сумма расхода')}
          <input
            className={inputClass}
            inputMode="decimal"
            {...form.register('amount')}
          />
          <span className="text-sm text-muted-foreground">
            Положительная сумма с десятичной точкой, без округления ввода.
          </span>
        </label>
        <label>
          Финансовая дата
          <input
            className={inputClass}
            type="date"
            {...form.register('financialDate')}
          />
        </label>
        <label>
          {text('Категория расхода')}
          <select
            aria-label={text('Категория расхода')}
            className={inputClass}
            {...form.register('categoryId')}
          >
            <option value="">Выберите категорию</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="new">{text('Создать категорию расхода')}</option>
          </select>
        </label>
        {categoryId === 'new' && (
          <label>
            {text('Название категории расхода')}
            <input className={inputClass} {...form.register('categoryName')} />
          </label>
        )}
        <label>
          {text('Описание расхода')}
          <textarea className={inputClass} {...form.register('description')} />
        </label>
        <Button type="submit">
          {isSubmitting ? 'Сохраняем…' : text('Добавить расход')}
        </Button>
      </fieldset>
      {result?.status === 'confirmation_required' && (
        <div
          ref={warningRef}
          tabIndex={-1}
          role="alertdialog"
          aria-label="Подтверждение отрицательного остатка"
          className="grid gap-3 rounded border p-4"
        >
          <p>
            {text(
              'Расход приведёт к отрицательному остатку. Подтвердите отдельно:',
            )}
          </p>
          {result.balances.map((b) => (
            <p key={b.accountId}>
              {accounts.find((a) => a.id === b.accountId)?.name}:{' '}
              {formatMoney(b.amount, b.currency)}
            </p>
          ))}
          <Button
            type="button"
            disabled={!form.formState.isReady || isSubmitting}
            onClick={() => {
              pending.current = null;
              key.current = null;
              setResult(null);
            }}
          >
            {text('Отменить расход')}
          </Button>
          <Button
            type="button"
            disabled={!form.formState.isReady || isSubmitting}
            onClick={() => {
              void form.handleSubmit(async () => {
                if (!pending.current || !key.current) return;
                try {
                  const r = await submitAction(
                    {
                      workspaceId,
                      operationKey: key.current,
                      confirmationToken: result.confirmationToken,
                    },
                    pending.current,
                  );
                  setResult(r);
                  if (r.status === 'success') {
                    key.current = null;
                    pending.current = null;
                    form.reset();
                    router.refresh();
                  }
                } catch {
                  setResult({ status: 'unavailable' });
                }
              })();
            }}
          >
            Подтвердить отрицательный остаток
          </Button>
        </div>
      )}
      {result && result.status !== 'confirmation_required' && (
        <div
          ref={feedback}
          tabIndex={-1}
          role={result.status === 'success' ? 'status' : 'alert'}
          className="break-words"
        >
          {result.status === 'success'
            ? text('Расход сохранён.')
            : result.status === 'validation'
              ? 'Проверьте поля, дату и точность суммы.'
              : result.status === 'forbidden'
                ? 'Нет доступа к счёту или категории.'
                : result.status === 'unauthorized'
                  ? 'Войдите в аккаунт.'
                  : result.status === 'conflict'
                    ? text(
                        'Это действие уже отправлено с другими данными. Проверьте историю перед новым расходом.',
                      )
                    : 'Не удалось сохранить. Ввод сохранён, повторите попытку.'}
        </div>
      )}
    </form>
  );
}
