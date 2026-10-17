import { z } from 'zod';
import { transferInput } from '@/modules/ledger/domain/transfers';
import { expenseInput } from '@/modules/categories/domain/expenses';
export const reserveWithdrawalInput = z.discriminatedUnion('kind', [
  transferInput.safeExtend({ kind: z.literal('transfer'), goalId: z.uuid() }),
  expenseInput.safeExtend({ kind: z.literal('expense'), goalId: z.uuid() }),
]);
export type ReserveWithdrawalInput = z.infer<typeof reserveWithdrawalInput>;
