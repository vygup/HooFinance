import 'server-only';
import { eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { financialAccount } from '@/server/db/schema/accounts';
import { projectAccount } from '@/modules/ledger/infrastructure/accounts-repository';
import { validateAmount } from '@/shared/money/decimal';
import type {
  SavingsAccountDto,
  SavingsAccountOption,
} from '../domain/savings-account';
export async function readGoalAccountOptions(
  tx: Transaction,
  workspaceId: string,
  occupiedAccountIds: readonly string[],
): Promise<SavingsAccountOption[]> {
  const accounts = await tx
    .select()
    .from(financialAccount)
    .where(eq(financialAccount.workspaceId, workspaceId))
    .orderBy(financialAccount.name, financialAccount.id);
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    balance: validateAmount(a.balanceProjection, a.currency),
    version: a.version.toString(),
    archived: !!a.archivedAt,
    occupied: occupiedAccountIds.includes(a.id),
  }));
}
export async function projectSavingsAccount(
  tx: Transaction,
  accountId: string,
  workspaceId: string,
  actorId: string,
): Promise<SavingsAccountDto> {
  const a = await projectAccount(tx, accountId, workspaceId, actorId);
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    name: a.name,
    type: a.type,
    currency: a.currency,
    openingBalance: a.openingBalance,
    balance: a.balance,
    archived: a.archived,
    version: a.version,
    history: a.history,
  };
}
