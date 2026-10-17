'use client';
import { TransferForm } from '@/modules/ledger/presentation/transfer-form';
import type {
  TransferAccountOption,
  TransferInput,
  TransferDto,
} from '@/modules/ledger/domain/transfers';
import type {
  CommandEnvelope,
  CommandResult,
} from '@/shared/contracts/commands';
import { formatMoney } from '@/shared/money/format';
import { formatFinancialDate } from '@/shared/calendar/calendar';
import type { GoalFundingView } from '../domain/goal-funding';
import { goalFundingAction } from './goal-funding-actions';
export function FundingHistory({
  workspaceId,
  view,
  accounts,
  today,
  locale,
}: {
  workspaceId: string;
  view: GoalFundingView;
  accounts: TransferAccountOption[];
  today: string;
  locale: string;
}) {
  const available = accounts.filter((a) => a.currency === view.goal.currency);
  async function submit(
    envelope: CommandEnvelope,
    input: unknown,
  ): Promise<CommandResult<TransferDto>> {
    const result = await goalFundingAction(
      { ...envelope, expectedVersion: view.goal.version },
      { ...(input as TransferInput), goalId: view.goal.id },
    );
    return result.status === 'success'
      ? { status: 'success', data: result.data.transfer }
      : result;
  }
  return (
    <>
      <section
        aria-label="История пополнений и списаний"
        className="grid gap-2 rounded border p-4"
      >
        <h3 className="font-medium">История пополнений и списаний</h3>
        <p>
          Баланс счёта:{' '}
          {formatMoney(view.account.balance, view.account.currency, locale)}
        </p>
        {view.account.history.length === 0 ? (
          <p>Операций пока нет.</p>
        ) : (
          <ul className="grid gap-2">
            {view.account.history.map((h) => (
              <li className="break-words" key={h.id}>
                {formatFinancialDate(h.date, locale)} ·{' '}
                {{
                  income: 'Доход',
                  expense: 'Расход',
                  transfer_in: 'Перевод на счёт',
                  transfer_out: 'Перевод со счёта',
                }[h.role] ?? h.role}
                : {formatMoney(h.amount, view.account.currency, locale)} ·
                остаток {formatMoney(h.balance, view.account.currency, locale)}
                {h.description && ` · ${h.description}`}
              </li>
            ))}
          </ul>
        )}
      </section>
      {!view.goal.archived && !view.account.archived && (
        <TransferForm
          workspaceId={workspaceId}
          accounts={available}
          today={today}
          destinationAccountId={view.goal.accountId}
          ariaLabel={`Пополнение цели ${view.goal.name}`}
          submitAction={submit}
        />
      )}
    </>
  );
}
