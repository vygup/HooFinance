'use client';
import { useEffect, useRef, useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { accountTypes } from '@/modules/ledger/domain/accounts';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import type { CommandResult } from '@/shared/contracts/commands';
import {
  eligibleGoalAccounts,
  type SavingsAccountDto,
  type SavingsAccountOption,
} from '../domain/savings-account';
import { savingsAccountHistoryAction } from './savings-account-actions';
export function SavingsAccountPicker({
  workspaceId,
  accounts,
  value,
  currentAccountId,
  registration,
  locale = 'ru-RU',
}: {
  workspaceId: string;
  accounts: SavingsAccountOption[];
  value: string;
  currentAccountId?: string | undefined;
  registration: UseFormRegisterReturn;
  locale?: string;
}) {
  const options = eligibleGoalAccounts(accounts, currentAccountId);
  const queryKey = `${workspaceId}:${value}:${accounts.find((a) => a.id === value)?.version ?? ''}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    attempt: number;
    result: CommandResult<SavingsAccountDto>;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!value) return;
    let active = true;
    void savingsAccountHistoryAction(workspaceId, { accountId: value })
      .then((result) => {
        if (active) setLoaded({ key: queryKey, attempt, result });
      })
      .catch(() => {
        if (active)
          setLoaded({
            key: queryKey,
            attempt,
            result: { status: 'unavailable' },
          });
      });
    return () => {
      active = false;
    };
  }, [workspaceId, value, queryKey, attempt]);
  const result =
    loaded?.key === queryKey && loaded.attempt === attempt
      ? loaded.result
      : null;
  useEffect(() => {
    if (result && result.status !== 'success') feedback.current?.focus();
  }, [result]);
  return (
    <>
      <label>
        Счёт цели
        <select
          className="block w-full rounded border bg-background p-2"
          {...registration}
        >
          <option value="">Выберите счёт</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 && (
        <p>
          Нет свободных активных счетов. Создайте счёт в разделе счетов или
          архивируйте прежнюю цель.
        </p>
      )}
      {value && (
        <section
          aria-label="Средства выбранного счёта"
          aria-busy={result === null}
          className="grid min-w-0 gap-2 rounded border p-3"
        >
          {result === null ? (
            <p role="status">Загружаем средства и историю…</p>
          ) : result.status === 'success' ? (
            <>
              <p>
                {accountTypes[result.data.type as keyof typeof accountTypes] ??
                  result.data.type}
              </p>
              <p className="break-all">
                Баланс счёта:{' '}
                {formatMoney(result.data.balance, result.data.currency, locale)}
              </p>
              <p className="break-all">
                Начальный остаток:{' '}
                {formatMoney(
                  result.data.openingBalance,
                  result.data.currency,
                  locale,
                )}
              </p>
              <p>
                Цель использует существующие средства целиком. Привязка не
                создаёт пополнения.
              </p>
              <h3 className="font-medium">
                История накоплений · включая операции до создания цели
              </h3>
              {result.data.history.length === 0 ? (
                <p>Операций пока нет.</p>
              ) : (
                <ul className="grid gap-2">
                  {result.data.history.map((h) => (
                    <li key={h.id} className="break-words">
                      {formatFinancialDate(h.date, locale)} ·{' '}
                      {{
                        income: 'Доход',
                        expense: 'Расход',
                        transfer_in: 'Перевод на счёт',
                        transfer_out: 'Перевод со счёта',
                      }[h.role] ?? h.role}
                      : {formatMoney(h.amount, result.data.currency, locale)} ·
                      остаток{' '}
                      {formatMoney(h.balance, result.data.currency, locale)}
                      {h.description && ` · ${h.description}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <p ref={feedback} role="alert" tabIndex={-1}>
                {result.status === 'forbidden' ||
                result.status === 'unauthorized'
                  ? 'Нет доступа к истории счёта.'
                  : 'Не удалось загрузить историю счёта.'}
              </p>
              <Button type="button" onClick={() => setAttempt((a) => a + 1)}>
                Повторить загрузку истории
              </Button>
            </>
          )}
        </section>
      )}
    </>
  );
}
