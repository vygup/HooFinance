'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/shared/money/format';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { accountInput } from '../domain/accounts-input';
import { accountTypes, type AccountDto } from '../domain/accounts';
import { accountAction } from './accounts-actions';
import type { CommandResult } from '@/shared/contracts/commands';
const inputClass = 'w-full rounded-md border bg-background px-3 py-2';
const messages: Record<string, string> = {
  validation: 'Проверьте заполненные поля и точность суммы.',
  conflict: 'Счёт уже изменён. Ввод сохранён. Загрузите актуальные данные.',
  forbidden: 'Нет доступа к счёту.',
  unauthorized: 'Войдите в аккаунт.',
  unavailable: 'Не удалось сохранить. Повторите попытку.',
};
type Fields = {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  description: string;
};
export function AccountForm({
  workspaceId,
  account,
  mode,
  currencies = [],
}: {
  workspaceId: string;
  account?: AccountDto;
  mode: 'create' | 'update' | 'correctOpening' | 'archive';
  currencies?: string[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<CommandResult<AccountDto> | null>(null);
  const key = useRef<string | null>(null),
    submitted = useRef<unknown>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const form = useForm<Fields>({
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'bank_card',
      currency: account?.currency ?? 'RUB',
      openingBalance: account?.openingBalance ?? '0',
      description: account?.description ?? '',
    },
  });
  const { isDirty, isSubmitting } = form.formState;
  useEffect(() => {
    if (result) feedback.current?.focus();
  }, [result]);
  const { reset } = form;
  useEffect(() => {
    if (!isDirty && account)
      reset({
        name: account.name,
        type: account.type,
        currency: account.currency,
        openingBalance: account.openingBalance,
        description: account.description,
      });
  }, [account, isDirty, reset]);
  useUnsavedChanges(isDirty);
  async function send(payload: unknown, confirmationToken?: string) {
    key.current ??= crypto.randomUUID();
    try {
      const r = await accountAction(
        {
          workspaceId,
          operationKey: key.current,
          ...(account ? { expectedVersion: account.version } : {}),
          ...(confirmationToken ? { confirmationToken } : {}),
        },
        payload,
      );
      setResult(r);
      if (r.status === 'success') {
        key.current = null;
        submitted.current = null;
        form.reset(
          mode === 'create'
            ? {
                name: '',
                type: 'bank_card',
                currency: 'RUB',
                openingBalance: '0',
                description: '',
              }
            : {
                name: r.data.name,
                type: r.data.type,
                currency: r.data.currency,
                openingBalance: r.data.openingBalance,
                description: r.data.description,
              },
        );
        router.refresh();
      }
    } catch {
      setResult({ status: 'unavailable' });
    }
  }
  return (
    <form
      aria-label={mode === 'create' ? 'Новый счёт' : mode}
      className="grid gap-3"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          if (
            mode === 'correctOpening' &&
            !window.confirm(
              'Исправить начальный остаток? Балансы будут пересчитаны, доходы и расходы сохранятся.',
            )
          )
            return;
          if (
            mode === 'archive' &&
            !window.confirm('Архивировать счёт? Средства и история сохранятся.')
          )
            return;
          const payload =
            mode === 'create'
              ? { command: mode, ...values }
              : mode === 'update'
                ? {
                    command: mode,
                    accountId: account!.id,
                    name: values.name,
                    type: values.type,
                    description: values.description,
                  }
                : mode === 'archive'
                  ? { command: mode, accountId: account!.id }
                  : {
                      command: mode,
                      accountId: account!.id,
                      openingBalance: values.openingBalance,
                      explicitConfirmation: true,
                    };
          const parsed = accountInput.safeParse(payload);
          if (!parsed.success) {
            setResult({ status: 'validation', fieldErrors: {} });
            const field = parsed.error.issues[0]?.path[0];
            if (typeof field === 'string' && field in values)
              form.setFocus(field as keyof Fields);
            return;
          }
          submitted.current = parsed.data;
          await send(parsed.data);
        })(event);
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
        {mode === 'create' && (
          <h2 className="text-xl font-medium">Новый счёт</h2>
        )}
        {(mode === 'create' || mode === 'update') && (
          <>
            <label>
              {mode === 'create' ? 'Название' : 'Название счёта'}
              <input className={inputClass} {...form.register('name')} />
            </label>
            <label>
              Тип счёта
              <select className={inputClass} {...form.register('type')}>
                {Object.entries(accountTypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Описание
              <textarea
                className={inputClass}
                {...form.register('description')}
              />
            </label>
          </>
        )}
        {mode === 'create' && (
          <label>
            Валюта
            <select className={inputClass} {...form.register('currency')}>
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        )}
        {(mode === 'create' || mode === 'correctOpening') && (
          <label>
            {mode === 'create'
              ? 'Начальный остаток'
              : 'Новый начальный остаток'}
            <input
              inputMode="decimal"
              className={inputClass}
              {...form.register('openingBalance')}
            />
            <span className="text-sm text-muted-foreground">
              Десятичная точка, без округления ввода.
            </span>
          </label>
        )}
        <Button
          type="submit"
          disabled={!form.formState.isReady || isSubmitting}
        >
          {isSubmitting
            ? 'Сохраняем…'
            : {
                create: 'Создать счёт',
                update: 'Сохранить описание',
                correctOpening: 'Исправить начальный остаток',
                archive: 'Архивировать',
              }[mode]}
        </Button>
      </fieldset>
      {result && (
        <div
          ref={feedback}
          tabIndex={-1}
          role={result.status === 'success' ? 'status' : 'alert'}
          className="grid gap-3 break-words"
        >
          {result.status === 'confirmation_required' ? (
            <>
              {result.balances.map((b) => (
                <p key={b.accountId}>
                  Отрицательный остаток: {formatMoney(b.amount, b.currency)}
                </p>
              ))}
              <Button
                type="button"
                disabled={!form.formState.isReady || isSubmitting}
                onClick={() => {
                  void form.handleSubmit(async () => {
                    await send(submitted.current, result.confirmationToken);
                  })();
                }}
              >
                Подтвердить отрицательный остаток
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!form.formState.isReady || isSubmitting}
                onClick={() => {
                  setResult(null);
                  key.current = null;
                  submitted.current = null;
                }}
              >
                Отмена
              </Button>
            </>
          ) : result.status === 'success' ? (
            'Сохранено.'
          ) : (
            (messages[result.status] ?? messages.unavailable)
          )}
          {result.status === 'conflict' && (
            <Button
              type="button"
              onClick={() => {
                if (
                  window.confirm('Загрузить актуальные данные и сбросить ввод?')
                ) {
                  form.reset();
                  key.current = null;
                  router.refresh();
                }
              }}
            >
              Загрузить актуальные данные
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
