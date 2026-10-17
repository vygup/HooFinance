import { z } from 'zod';
import Decimal from 'decimal.js';
import { incomeInput } from '@/modules/ledger/domain/income';
import { needsNegativeWarning } from '@/modules/ledger/domain/accounts';
import { subtractMoney, validateAmount } from '@/shared/money/decimal';
export const expenseInput = incomeInput;
export const categoryInput = z.discriminatedUnion('command', [
  z.strictObject({
    command: z.literal('create'),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['income', 'expense']),
  }),
  z.strictObject({
    command: z.literal('update'),
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
  }),
  z.strictObject({ command: z.literal('archive'), id: z.uuid() }),
]);
export type CategoryInput = z.infer<typeof categoryInput>;
export type CategoryDto = {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  archived: boolean;
  version: string;
};
export function acceptExpense(
  balance: string,
  amount: string,
  currency: string,
) {
  const normalized = validateAmount(amount, currency);
  if (!new Decimal(normalized).gt('0')) throw Error('INVALID_EXPENSE');
  const next = subtractMoney(balance, normalized, currency);
  return {
    amount: normalized,
    balance: next,
    warning: needsNegativeWarning(balance, next),
  };
}
