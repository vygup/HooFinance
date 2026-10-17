import { z } from 'zod';
import Decimal from 'decimal.js';
import { dateOnly } from '@/shared/calendar/calendar';
import { addMoney, validateAmount } from '@/shared/money/decimal';
export const incomeInput = z.strictObject({
  accountId: z.uuid(),
  category: z.union([
    z.strictObject({ id: z.uuid() }),
    z.strictObject({ name: z.string().trim().min(1).max(200) }),
  ]),
  amount: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
    .refine((value) => {
      try {
        return new Decimal(value).isFinite() && new Decimal(value).gt('0');
      } catch {
        return false;
      }
    }),
  financialDate: z.string().refine((value) => {
    try {
      dateOnly(value);
      return true;
    } catch {
      return false;
    }
  }),
  description: z.string().trim().max(2000).default(''),
});
export type IncomeInput = z.infer<typeof incomeInput>;
export type IncomeDto = {
  id: string;
  workspaceId: string;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  financialDate: string;
  description: string;
  version: string;
};
export function acceptIncome(
  balance: string,
  amount: string,
  currency: string,
) {
  const normalized = validateAmount(amount, currency);
  if (!new Decimal(normalized).gt('0')) throw new Error('INVALID_INCOME');
  return {
    amount: normalized,
    balance: addMoney([balance, normalized], currency),
  };
}
export function incomeTotals(
  legs: readonly { amount: string; currency: string }[],
) {
  return [...new Set(legs.map((leg) => leg.currency))]
    .sort()
    .map((currency) => ({
      currency,
      amount: addMoney(
        legs
          .filter((leg) => leg.currency === currency)
          .map((leg) => leg.amount),
        currency,
      ),
    }));
}
