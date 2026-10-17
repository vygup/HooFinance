'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState, startTransition } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/shared/money/format';
import type { CommandResult } from '@/shared/contracts/commands';
import {
  transferInput,
  type TransferInput,
  type TransferDto,
  type TransferAccountOption,
} from '../domain/transfers';
import { transferAction } from './transfers-actions';
type Fields = Pick<
  TransferInput,
  | 'sourceAccountId'
  | 'destinationAccountId'
  | 'debitAmount'
  | 'creditAmount'
  | 'financialDate'
  | 'sourceDescription'
  | 'destinationDescription'
>;
const style = 'w-full rounded-md border bg-background px-3 py-2';
export function TransferForm({
  workspaceId,
  accounts,
  today,
  destinationAccountId = '',
  sourceAccountId = '',
  ariaLabel = 'Новый перевод',
  submitAction = transferAction,
}: {
  workspaceId: string;
  accounts: TransferAccountOption[];
  today: string;
  destinationAccountId?: string;
  sourceAccountId?: string;
  ariaLabel?: string;
  submitAction?: typeof transferAction;
}) {
  const router = useRouter();
  const form = useForm<Fields>({
    defaultValues: {
      sourceAccountId,
      destinationAccountId,
      debitAmount: '',
      creditAmount: '',
      financialDate: today,
      sourceDescription: '',
      destinationDescription: '',
    },
  });
  const { isDirty, isSubmitting, isReady } = form.formState;
  const [result, setResult] = useState<CommandResult<TransferDto> | null>(null);
  const [invalid, setInvalid] = useState<keyof Fields | null>(null);
  const key = useRef<string | null>(null),
    pending = useRef<TransferInput | null>(null),
    feedback = useRef<HTMLDivElement>(null),
    warning = useRef<HTMLDivElement>(null);
  const { setFocus } = form;
  useEffect(() => {
    if (!isSubmitting && invalid && result?.status === 'validation')
      setFocus(invalid);
    else if (result?.status === 'confirmation_required')
      warning.current?.focus();
    else if (result) feedback.current?.focus();
  }, [result, invalid, isSubmitting, setFocus]);
  useUnsavedChanges(isDirty);
  async function send(payload: TransferInput, confirmationToken?: string) {
    key.current ??= crypto.randomUUID();
    pending.current = payload;
    try {
      const r = await submitAction(
        { workspaceId, operationKey: key.current, confirmationToken },
        payload,
      );
      setResult(r);
      if (r.status === 'success') {
        key.current = null;
        pending.current = null;
        router.refresh();
        form.reset({
          ...form.getValues(),
          debitAmount: '',
          creditAmount: '',
          sourceDescription: '',
          destinationDescription: '',
        });
      }
      if (r.status === 'validation') {
        const field = Object.keys(r.fieldErrors)[0];
        if (field && field in form.getValues())
          setInvalid(field as keyof Fields);
      }
    } catch {
      setResult({ status: 'unavailable' });
    }
  }
  return (
    <form
      aria-label={ariaLabel}
      className="grid gap-3 rounded-lg border p-5"
      noValidate
      onChange={() => {
        if (result?.status === 'confirmation_required') {
          setResult(null);
          pending.current = null;
        }
      }}
      onSubmit={(event) => {
        startTransition(() => {
          void form.handleSubmit(async (values) => {
            const source = accounts.find(
                (a) => a.id === values.sourceAccountId,
              ),
              destination = accounts.find(
                (a) => a.id === values.destinationAccountId,
              );
            const parsed = transferInput.safeParse({
              ...values,
              sourceWorkspaceId: source?.workspaceId,
              destinationWorkspaceId: destination?.workspaceId,
            });
            if (!parsed.success) {
              const path = parsed.error.issues[0]?.path[0];
              setInvalid(
                path === 'sourceWorkspaceId'
                  ? 'sourceAccountId'
                  : path === 'destinationWorkspaceId'
                    ? 'destinationAccountId'
                    : (path as keyof Fields),
              );
              setResult({ status: 'validation', fieldErrors: {} });
              return;
            }
            setInvalid(null);
            await send(parsed.data);
          })(event);
        });
      }}
    >
      <h2 className="text-xl font-medium">{ariaLabel}</h2>
      <p className="text-sm text-muted-foreground">
        Перевод между разными счетами в одной валюте. Суммы списания и
        зачисления должны совпадать. Доходы и расходы не меняются.
      </p>
      <p className="text-sm text-muted-foreground">
        Описания видны только в пространстве соответствующего счёта. Для
        перевода личное ↔ семья необходим доступ к обеим сторонам.
      </p>
      <fieldset
        className="grid min-w-0 gap-3"
        disabled={!isReady || isSubmitting || accounts.length < 2}
      >
        {(
          [
            ['sourceAccountId', 'Счёт отправителя'],
            ['destinationAccountId', 'Счёт получателя'],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            {label}
            <select
              className={style}
              {...form.register(field)}
              disabled={
                (field === 'destinationAccountId' && !!destinationAccountId) ||
                (field === 'sourceAccountId' && !!sourceAccountId)
              }
            >
              <option value="">Выберите счёт</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.workspaceName} · {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            ['debitAmount', 'Сумма списания'],
            ['creditAmount', 'Сумма зачисления'],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            {label}
            <input
              className={style}
              inputMode="decimal"
              {...form.register(field)}
            />
          </label>
        ))}
        <label>
          Дата перевода
          <input
            className={style}
            type="date"
            {...form.register('financialDate')}
          />
        </label>
        <label>
          Описание в пространстве отправителя
          <textarea className={style} {...form.register('sourceDescription')} />
        </label>
        <label>
          Описание в пространстве получателя
          <textarea
            className={style}
            {...form.register('destinationDescription')}
          />
        </label>
        <Button type="submit">
          {isSubmitting ? 'Сохраняем…' : 'Перевести'}
        </Button>
      </fieldset>
      {accounts.length < 2 && <p>Создайте два активных счёта для перевода.</p>}
      {result?.status === 'confirmation_required' && (
        <div
          ref={warning}
          tabIndex={-1}
          role="alertdialog"
          aria-label="Подтверждение отрицательного остатка"
          className="grid gap-3 rounded border p-4"
        >
          <p>
            Перевод приведёт к отрицательному остатку. Подтвердите отдельно:
          </p>
          {result.balances.map((b) => (
            <p key={b.accountId}>
              {accounts.find((a) => a.id === b.accountId)?.name}:{' '}
              {formatMoney(b.amount, b.currency)}
            </p>
          ))}
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              pending.current = null;
              key.current = null;
              setResult(null);
              form.setFocus('debitAmount');
            }}
          >
            Отменить перевод
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              startTransition(() => {
                void form.handleSubmit(async () => {
                  if (pending.current)
                    await send(pending.current, result.confirmationToken);
                })();
              });
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
        >
          {result.status === 'success'
            ? 'Перевод сохранён.'
            : result.status === 'validation'
              ? 'Проверьте счета, дату, валюты и равенство точных сумм.'
              : result.status === 'forbidden'
                ? 'Нет доступа к обеим сторонам перевода.'
                : result.status === 'unauthorized'
                  ? 'Войдите в аккаунт.'
                  : result.status === 'conflict'
                    ? 'Действие уже отправлено с другими данными. Проверьте историю перед новым переводом.'
                    : 'Не удалось сохранить. Ввод сохранён, повторите попытку.'}
        </div>
      )}
    </form>
  );
}
