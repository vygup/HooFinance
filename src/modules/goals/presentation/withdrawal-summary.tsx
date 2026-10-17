'use client';
import { TransferForm } from '@/modules/ledger/presentation/transfer-form';
import { ExpenseForm } from '@/modules/ledger/presentation/expense-form';
import type {
  TransferAccountOption,
  TransferInput,
  TransferDto,
} from '@/modules/ledger/domain/transfers';
import type { IncomeDto } from '@/modules/ledger/domain/income';
import type {
  CommandEnvelope,
  CommandResult,
} from '@/shared/contracts/commands';
import type { GoalFundingView } from '../domain/goal-funding';
import { reserveWithdrawalAction } from './reserve-withdrawal-actions';
export function WithdrawalSummary({
  workspaceId,
  view,
  accounts,
  today,
  categories,
}: {
  workspaceId: string;
  view: GoalFundingView;
  accounts: TransferAccountOption[];
  today: string;
  categories: { id: string; name: string }[];
}) {
  if (
    view.goal.type !== 'reserve' ||
    view.goal.archived ||
    view.account.archived
  )
    return null;
  async function transfer(
    envelope: CommandEnvelope,
    input: unknown,
  ): Promise<CommandResult<TransferDto>> {
    const r = await reserveWithdrawalAction(
      { ...envelope, expectedVersion: view.goal.version },
      { ...(input as TransferInput), kind: 'transfer', goalId: view.goal.id },
    );
    if (r.status !== 'success') return r;
    return 'transfer' in r.data
      ? { status: 'success', data: r.data.transfer }
      : { status: 'unavailable' };
  }
  async function expense(
    envelope: CommandEnvelope,
    input: unknown,
  ): Promise<CommandResult<IncomeDto>> {
    const r = await reserveWithdrawalAction(
      { ...envelope, expectedVersion: view.goal.version },
      { ...(input as object), kind: 'expense', goalId: view.goal.id },
    );
    if (r.status !== 'success') return r;
    return 'expense' in r.data
      ? { status: 'success', data: r.data.expense }
      : { status: 'unavailable' };
  }
  return (
    <section
      aria-label={`Использование резерва ${view.goal.name}`}
      className="grid gap-3"
    >
      <h3 className="font-medium">Использование резерва</h3>
      <p>
        Расход уменьшает общие средства. Перевод сохраняет деньги на другом
        счёте. Покрытие резерва пересчитывается по его остатку.
      </p>
      <ExpenseForm
        workspaceId={workspaceId}
        accounts={[
          {
            id: view.goal.accountId,
            name: view.goal.accountName,
            currency: view.goal.currency,
          },
        ]}
        categories={categories}
        today={today}
        accountId={view.goal.accountId}
        submitAction={expense}
      />
      <TransferForm
        workspaceId={workspaceId}
        accounts={accounts.filter((a) => a.currency === view.goal.currency)}
        today={today}
        sourceAccountId={view.goal.accountId}
        ariaLabel={`Снятие резерва ${view.goal.name}`}
        submitAction={transfer}
      />
    </section>
  );
}
