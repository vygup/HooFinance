'use server';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { expenseAction } from '@/modules/ledger/presentation/expense-actions';
export async function createExpenseAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  return expenseAction(envelope, input);
}
