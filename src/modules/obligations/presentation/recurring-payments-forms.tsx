'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { formatMoney } from '@/shared/money/format';
import type { GoalDto } from '@/modules/goals/domain/reserve';
import type { readObligations } from '../application/recurring-payments';
import {
  recurringPaymentInput,
  confirmPaymentInput,
} from '../domain/recurring-payments-input';
import {
  recurringPaymentAction,
  confirmPaymentAction,
} from './recurring-payments-actions';
import { categoryAction } from '@/modules/categories/presentation/category-actions';
type Data = Awaited<ReturnType<typeof readObligations>>;
function useSubmission(workspaceId: string, success: string, payment = false) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<{
    token: string;
    input: unknown;
    version: string | undefined;
    balances: readonly {
      accountId: string;
      amount: string;
      currency: string;
    }[];
  } | null>(null);
  const pending = useRef<{ key: string; payload: string } | null>(null);
  async function submit(input: unknown, version?: string, token?: string) {
    const payload = JSON.stringify({ input, version });
    if (pending.current && pending.current.payload !== payload) {
      setMessage(
        'Повторите прежнюю отправку с теми же данными или обновите страницу.',
      );
      return false;
    }
    pending.current ??= { key: crypto.randomUUID(), payload };
    setBusy(true);
    try {
      const action = payment ? confirmPaymentAction : recurringPaymentAction;
      const result = await action(
        {
          workspaceId,
          operationKey: pending.current.key,
          expectedVersion: version,
          confirmationToken: token,
        },
        input,
      );
      if (result.status === 'confirmation_required') {
        setWarning({
          token: result.confirmationToken,
          input,
          version,
          balances: result.balances,
        });
        setMessage(
          'После оплаты остаток станет отрицательным. Подтвердите изменение.',
        );
        return false;
      }
      setWarning(null);
      if (result.status === 'success') {
        pending.current = null;
        setMessage(success);
        router.refresh();
        return true;
      }
      if (result.status !== 'unavailable') pending.current = null;
      setMessage(
        result.status === 'conflict'
          ? 'Данные изменились. Обновите страницу.'
          : result.status === 'validation'
            ? 'Проверьте введённые данные.'
            : result.status === 'forbidden' || result.status === 'unauthorized'
              ? 'Нет доступа к этому действию.'
              : 'Не удалось сохранить. Повторите отправку с теми же данными.',
      );
    } catch {
      setMessage('Не удалось сохранить. Повторите отправку с теми же данными.');
    } finally {
      setBusy(false);
    }
    return false;
  }
  return {
    submit,
    busy,
    setMessage,
    message,
    warning,
    cancel: () => {
      setWarning(null);
      pending.current = null;
      setMessage('Оплата отменена. Введённые данные сохранены.');
    },
  };
}
function Feedback({
  submission,
}: {
  submission: ReturnType<typeof useSubmission>;
}) {
  const s = submission;
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (s.message) status.current?.focus();
  }, [s.message]);
  return (
    <>
      <p role="status" tabIndex={-1} ref={status}>
        {s.message}
      </p>
      {s.warning && (
        <div
          role="group"
          aria-label="Подтверждение отрицательного остатка"
          className="rounded border p-3"
        >
          {s.warning.balances.map((b) => (
            <p key={b.accountId}>
              Остаток после оплаты: {formatMoney(b.amount, b.currency)}
            </p>
          ))}
          <Button
            type="button"
            disabled={s.busy}
            onClick={() =>
              void s.submit(
                s.warning!.input,
                s.warning!.version,
                s.warning!.token,
              )
            }
          >
            Подтвердить отрицательный остаток
          </Button>
          <Button type="button" disabled={s.busy} onClick={s.cancel}>
            Отмена
          </Button>
        </div>
      )}
    </>
  );
}
const inputClass = 'w-full min-w-0 rounded border bg-background p-2';
export function ObligationEditor({
  workspaceId,
  data,
  obligation: old,
}: {
  workspaceId: string;
  data: Data;
  obligation?: Data['obligations'][number];
}) {
  const form = useForm({
    defaultValues: {
      name: old?.name ?? '',
      amount: old?.amount ?? '',
      repeatEvery: String(old?.repeatEvery ?? 1),
      repeatUnit: old?.repeatUnit ?? 'month',
      anchorDate: old?.anchorDate ?? data.today,
      accountId: old?.accountId ?? data.accounts[0]?.id ?? '',
      categoryId: old?.categoryId ?? data.categories[0]?.id ?? '',
      newCategory: '',
    },
  });
  useUnsavedChanges(form.formState.isDirty);
  const submission = useSubmission(
    workspaceId,
    old ? 'Обязательство сохранено.' : 'Обязательство создано.',
  );
  const categoryKey = useRef(crypto.randomUUID());
  return (
    <form
      aria-label={old ? `Изменить ${old.name}` : 'Новое обязательство'}
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (v) => {
          const account = data.accounts.find((a) => a.id === v.accountId);
          const payload = {
            command: old ? 'update' : 'create',
            ...(old ? { id: old.id } : {}),
            name: v.name,
            amount: v.amount,
            currency: account?.currency,
            repeatEvery: Number(v.repeatEvery),
            repeatUnit: v.repeatUnit,
            anchorDate: v.anchorDate,
            accountId: v.accountId,
            categoryId: v.newCategory
              ? '10000000-0000-4000-8000-000000000001'
              : v.categoryId,
          };
          const parsed = recurringPaymentInput.safeParse(payload);
          if (!parsed.success) {
            submission.setMessage(
              'Проверьте сумму, дату, счёт, категорию и периодичность.',
            );
            form.setFocus('name');
            return;
          }
          if (v.newCategory) {
            try {
              const result = await categoryAction(
                { workspaceId, operationKey: categoryKey.current },
                { command: 'create', kind: 'expense', name: v.newCategory },
              );
              if (result.status !== 'success') {
                submission.setMessage(
                  'Не удалось создать категорию. Проверьте название и повторите.',
                );
                return;
              }
              payload.categoryId = result.data.id;
            } catch {
              submission.setMessage(
                'Не удалось создать категорию. Повторите отправку.',
              );
              return;
            }
          }
          if (await submission.submit(payload, old?.version)) {
            categoryKey.current = crypto.randomUUID();
            form.reset(v);
          }
        })(event);
      }}
    >
      <fieldset
        disabled={submission.busy || form.formState.isSubmitting}
        className="grid gap-3"
      >
        <legend className="font-medium">
          {old ? 'Изменить обязательство' : 'Новое обязательство'}
        </legend>
        <label>
          Название
          <input className={inputClass} {...form.register('name')} />
        </label>
        <label>
          Сумма
          <input
            inputMode="decimal"
            className={inputClass}
            {...form.register('amount')}
          />
        </label>
        <label>
          Повторять каждые
          <input
            type="number"
            min="1"
            step="1"
            className={inputClass}
            {...form.register('repeatEvery')}
          />
        </label>
        <label>
          Единица периода
          <select className={inputClass} {...form.register('repeatUnit')}>
            <option value="day">Дней</option>
            <option value="week">Недель</option>
            <option value="month">Месяцев</option>
            <option value="year">Лет</option>
          </select>
        </label>
        <label>
          Исходная дата
          <input
            type="date"
            className={inputClass}
            {...form.register('anchorDate')}
          />
        </label>
        <label>
          Счёт оплаты
          <select className={inputClass} {...form.register('accountId')}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Категория расхода
          <select className={inputClass} {...form.register('categoryId')}>
            <option value="">Выберите категорию</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Новая категория расхода
          <input className={inputClass} {...form.register('newCategory')} />
        </label>
        <Button type="submit">
          {submission.busy
            ? 'Сохранение…'
            : old
              ? 'Сохранить обязательство'
              : 'Создать обязательство'}
        </Button>
      </fieldset>
      <Feedback submission={submission} />
    </form>
  );
}
export function ObligationLifecycle({
  workspaceId,
  obligation: o,
}: {
  workspaceId: string;
  obligation: Data['obligations'][number];
}) {
  const s = useSubmission(workspaceId, 'Статус обязательства изменён.');
  return (
    <div>
      {o.status !== 'archived' && (
        <>
          <Button
            disabled={s.busy}
            onClick={() =>
              void s.submit(
                {
                  command: o.status === 'active' ? 'pause' : 'resume',
                  id: o.id,
                },
                o.version,
              )
            }
          >
            {o.status === 'active' ? 'Приостановить' : 'Возобновить'}
          </Button>
          <Button
            disabled={s.busy}
            onClick={() => {
              if (
                window.confirm(
                  'Архивировать обязательство? История и резерв сохранятся.',
                )
              )
                void s.submit({ command: 'archive', id: o.id }, o.version);
            }}
          >
            Архивировать обязательство
          </Button>
        </>
      )}
      <Feedback submission={s} />
    </div>
  );
}
export function PaymentForm({
  workspaceId,
  payment: p,
  today,
  accounts,
}: {
  workspaceId: string;
  payment: Data['payments'][number];
  today: string;
  accounts: Data['accounts'];
}) {
  const form = useForm({
    defaultValues: {
      actualAmount: p.scheduledAmount,
      actualDate: today,
      accountId: p.accountId,
    },
  });
  useUnsavedChanges(form.formState.isDirty);
  const s = useSubmission(workspaceId, 'Оплата подтверждена.', true);
  return (
    <form
      aria-label={`Оплата ${p.name} ${p.scheduledDate}`}
      className="grid gap-2 rounded border p-3"
      onSubmit={(event) => {
        void form.handleSubmit(async (v) => {
          const input = { ...v, occurrenceId: p.id };
          if (!confirmPaymentInput.safeParse(input).success) {
            s.setMessage('Проверьте сумму и дату.');
            form.setFocus('actualAmount');
            return;
          }
          if (await s.submit(input)) form.reset(v);
        })(event);
      }}
    >
      <fieldset disabled={s.busy || p.status === 'paid'} className="grid gap-2">
        <legend>
          {p.status === 'paid' ? 'Оплачено' : 'Подтверждение оплаты'}
        </legend>
        <label>
          Фактическая сумма
          <input
            className={inputClass}
            inputMode="decimal"
            {...form.register('actualAmount')}
          />
        </label>
        <label>
          Фактическая дата
          <input
            className={inputClass}
            type="date"
            {...form.register('actualDate')}
          />
        </label>
        <label>
          Счёт оплаты
          <select className={inputClass} {...form.register('accountId')}>
            {accounts
              .filter((a) => a.currency === p.currency)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
          </select>
        </label>
        <Button type="submit">
          {s.busy ? 'Сохранение…' : 'Подтвердить оплату'}
        </Button>
      </fieldset>
      <Feedback submission={s} />
    </form>
  );
}
export function ReserveObligationLink({
  workspaceId,
  goal,
  obligations,
}: {
  workspaceId: string;
  goal: GoalDto;
  obligations: Data['obligations'];
}) {
  const form = useForm({
    defaultValues: { obligationId: goal.linkedObligationId ?? '' },
  });
  useUnsavedChanges(form.formState.isDirty);
  const s = useSubmission(workspaceId, 'Связь резерва сохранена.');
  return (
    <form
      aria-label={`Связь резерва ${goal.name}`}
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (v) => {
          if (
            await s.submit(
              {
                command: 'linkReserve',
                goalId: goal.id,
                obligationId: v.obligationId || null,
              },
              goal.version,
            )
          )
            form.reset(v);
        })(event);
      }}
    >
      <p>
        {goal.name} · Накоплено:{' '}
        {formatMoney(goal.progress.actual, goal.currency)} · Требуется:{' '}
        {formatMoney(goal.progress.target, goal.currency)}
      </p>
      {goal.linkedObligationId && (
        <p>
          Связано: {goal.linkedObligationName} ·{' '}
          {goal.linkedObligationStatus === 'active'
            ? 'Активно'
            : goal.linkedObligationStatus === 'paused'
              ? 'Приостановлено'
              : 'Архивировано'}
        </p>
      )}
      <label>
        Ежемесячное обязательство
        <select
          className={inputClass}
          disabled={s.busy}
          {...form.register('obligationId')}
        >
          <option value="">Ручное управление суммой</option>
          {obligations
            .filter(
              (o) =>
                o.currency === goal.currency &&
                o.repeatEvery === 1 &&
                o.repeatUnit === 'month',
            )
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {formatMoney(o.amount, o.currency)}
              </option>
            ))}
        </select>
      </label>
      <p>
        Разрыв связи сохраняет текущую ежемесячную сумму для ручного управления.
      </p>
      <Button disabled={s.busy} type="submit">
        Сохранить связь
      </Button>
      <Feedback submission={s} />
    </form>
  );
}
