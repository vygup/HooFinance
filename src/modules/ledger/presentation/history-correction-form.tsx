'use client';
import { startTransition, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { formatMoney } from '@/shared/money/format';
import type { CommandResult } from '@/shared/contracts/commands';
import {
  historyInput,
  type HistoryAction,
  type HistoryInput,
} from '../domain/history-corrections';
import { historyCorrectionAction } from './history-corrections-actions';

type Fields = {
  accountId: string;
  destinationAccountId: string;
  amount: string;
  creditAmount: string;
  categoryId: string;
  financialDate: string;
  description: string;
  destinationDescription: string;
};
type Option = {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  archived?: boolean;
};
const inputClass = 'block w-full rounded-md border bg-background px-3 py-2';
export function HistoryCorrectionForm({
  action,
  accounts,
  categories,
}: {
  action: HistoryAction;
  accounts: Option[];
  categories: { id: string; name: string; kind: string; archived: boolean }[];
}) {
  const router = useRouter();
  const legs = action.editLegs;
  const source = legs.find((l) => l.role === 'transfer_out') ?? legs[0]!;
  const destination = legs.find((l) => l.role === 'transfer_in');
  const transfer = action.kind === 'transfer';
  const form = useForm<Fields>({
    defaultValues: {
      accountId: source.accountId,
      destinationAccountId: destination?.accountId ?? '',
      amount: source.amount,
      creditAmount: destination?.amount ?? '',
      categoryId: source.categoryId ?? '',
      financialDate: source.financialDate,
      description: source.description,
      destinationDescription: destination?.description ?? '',
    },
  });
  const { isDirty, isSubmitting } = form.formState;
  useUnsavedChanges(isDirty);
  const [result, setResult] = useState<CommandResult<HistoryAction> | null>(
    null,
  );
  const [invalidField, setInvalidField] = useState<keyof Fields | null>(null);
  const feedback = useRef<HTMLDivElement>(null),
    warning = useRef<HTMLDivElement>(null);
  const pending = useRef<{ input: HistoryInput; key: string } | null>(null);
  const { setFocus } = form;
  useEffect(() => {
    if (isSubmitting) return;
    if (invalidField) setFocus(invalidField);
    else if (result?.status === 'confirmation_required')
      warning.current?.focus();
    else if (result) feedback.current?.focus();
  }, [result, invalidField, setFocus, isSubmitting]);
  const available = (workspaceId: string, accountId: string) =>
    accounts.filter(
      (a) =>
        a.workspaceId === workspaceId &&
        (!a.archived || a.id === accountId) &&
        a.currency === source.currency,
    );
  async function send(input: HistoryInput, confirmationToken?: string) {
    setInvalidField(null);
    if (
      !pending.current ||
      JSON.stringify(pending.current.input) !== JSON.stringify(input)
    )
      pending.current = { input, key: crypto.randomUUID() };
    try {
      const response = await historyCorrectionAction(
        {
          workspaceId: action.workspaceId,
          expectedVersion: action.version,
          operationKey: pending.current.key,
          ...(confirmationToken ? { confirmationToken } : {}),
        },
        input,
      );
      setResult(response);
      if (response.status === 'success') {
        pending.current = null;
        form.reset(form.getValues());
        router.refresh();
      } else if (response.status === 'validation') {
        const field = Object.keys(response.fieldErrors)[0];
        setInvalidField(
          field === 'debitAmount'
            ? 'amount'
            : field && field in form.getValues()
              ? (field as keyof Fields)
              : 'amount',
        );
      }
    } catch {
      setResult({ status: 'unavailable' });
    }
  }
  return (
    <form
      aria-label="Исправление операции"
      className="grid gap-3"
      noValidate
      onChange={() => {
        if (result?.status === 'confirmation_required') setResult(null);
      }}
      onSubmit={(event) => {
        startTransition(() => {
          void form.handleSubmit(async (v) => {
            const input = transfer
              ? {
                  command: 'updateTransfer',
                  actionId: action.id,
                  sourceWorkspaceId: source.workspaceId,
                  destinationWorkspaceId: destination!.workspaceId,
                  sourceAccountId: v.accountId,
                  destinationAccountId: v.destinationAccountId,
                  debitAmount: v.amount,
                  creditAmount: v.creditAmount,
                  financialDate: v.financialDate,
                  sourceDescription: v.description,
                  destinationDescription: v.destinationDescription,
                }
              : {
                  command: 'updateEntry',
                  actionId: action.id,
                  accountId: v.accountId,
                  categoryId: v.categoryId,
                  amount: v.amount,
                  financialDate: v.financialDate,
                  description: v.description,
                };
            const parsed = historyInput.safeParse(input);
            if (!parsed.success) {
              setResult({ status: 'validation', fieldErrors: {} });
              const key = parsed.error.issues[0]?.path[0];
              setInvalidField(
                key === 'debitAmount'
                  ? 'amount'
                  : key === 'sourceAccountId'
                    ? 'accountId'
                    : key && typeof key === 'string' && key in v
                      ? (key as keyof Fields)
                      : 'amount',
              );
              return;
            }
            await send(parsed.data);
          })(event);
        });
      }}
    >
      <fieldset
        disabled={
          !form.formState.isReady ||
          isSubmitting ||
          result?.status === 'confirmation_required'
        }
        className="grid min-w-0 gap-3"
      >
        <label>
          {transfer ? 'Со счёта' : 'Счёт операции'}
          <select className={inputClass} {...form.register('accountId')}>
            {available(source.workspaceId, source.accountId).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
                {a.archived ? ' · Архивный' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          {transfer ? 'Сумма списания' : 'Сумма'}
          <input
            className={inputClass}
            inputMode="decimal"
            {...form.register('amount')}
          />
        </label>
        {transfer && (
          <>
            <label>
              На счёт
              <select
                className={inputClass}
                {...form.register('destinationAccountId')}
              >
                {available(
                  destination!.workspaceId,
                  destination!.accountId,
                ).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                    {a.archived ? ' · Архивный' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Сумма зачисления
              <input
                className={inputClass}
                inputMode="decimal"
                {...form.register('creditAmount')}
              />
            </label>
            <p>
              Перевод исправляется и удаляется целиком. Суммы в одной валюте
              должны совпадать.
            </p>
          </>
        )}
        {!transfer && (
          <label>
            Категория операции
            <select className={inputClass} {...form.register('categoryId')}>
              {categories
                .filter(
                  (c) =>
                    c.kind === action.kind &&
                    (!c.archived || c.id === source.categoryId),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? ' · Архивная' : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Финансовая дата
          <input
            className={inputClass}
            type="date"
            {...form.register('financialDate')}
          />
        </label>
        <label>
          {transfer ? 'Описание списания' : 'Описание'}
          <textarea className={inputClass} {...form.register('description')} />
        </label>
        {transfer && (
          <label>
            Описание зачисления
            <textarea
              className={inputClass}
              {...form.register('destinationDescription')}
            />
          </label>
        )}
        <Button type="submit">
          {isSubmitting ? 'Сохраняем…' : 'Сохранить исправление'}
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                'Удалить операцию целиком? Финансовое влияние будет отменено, история сохранится.',
              )
            )
              return;
            startTransition(() => {
              void form.handleSubmit(async () =>
                send({
                  command: 'delete',
                  actionId: action.id,
                  explicitConfirmation: true,
                }),
              )();
            });
          }}
        >
          Удалить операцию
        </Button>
      </fieldset>
      {result?.status === 'confirmation_required' && (
        <div
          role="alertdialog"
          aria-label="Подтверждение отрицательного остатка"
          tabIndex={-1}
          ref={warning}
          className="grid gap-3 rounded border p-4"
        >
          <p>
            Изменение создаст или увеличит отрицательный остаток. Подтвердите
            рассчитанные остатки:
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
              setResult(null);
              setFocus('amount');
            }}
          >
            Отменить изменение
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              startTransition(() => {
                void form.handleSubmit(async () => {
                  if (pending.current)
                    await send(pending.current.input, result.confirmationToken);
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
          tabIndex={-1}
          ref={feedback}
          role={result.status === 'success' ? 'status' : 'alert'}
        >
          {result.status === 'success'
            ? 'Изменение сохранено.'
            : result.status === 'validation'
              ? 'Проверьте поля, дату и точность суммы.'
              : result.status === 'conflict'
                ? 'Операция уже изменена. Обновите страницу и проверьте историю.'
                : result.status === 'forbidden'
                  ? 'Нет доступа к операции, счёту или категории.'
                  : result.status === 'unauthorized'
                    ? 'Войдите в аккаунт.'
                    : 'Не удалось сохранить. Ввод сохранён, повторите попытку.'}
        </div>
      )}
    </form>
  );
}
