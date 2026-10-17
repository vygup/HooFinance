import { z } from 'zod';
import type { AccountDto } from '@/modules/ledger/domain/accounts';
export const savingsAccountSelection = z.strictObject({ accountId: z.uuid() });
export type SavingsAccountOption = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  version: string;
  archived: boolean;
  occupied: boolean;
};
export type SavingsAccountDto = Pick<
  AccountDto,
  | 'id'
  | 'workspaceId'
  | 'name'
  | 'type'
  | 'currency'
  | 'openingBalance'
  | 'balance'
  | 'archived'
  | 'version'
  | 'history'
>;
/** Account type is descriptive: every supported monetary account may fund a goal. */
export function eligibleGoalAccounts<
  T extends { id: string; archived: boolean; occupied: boolean },
>(accounts: readonly T[], currentAccountId?: string) {
  return accounts.filter(
    (a) => (!a.archived && !a.occupied) || a.id === currentAccountId,
  );
}
