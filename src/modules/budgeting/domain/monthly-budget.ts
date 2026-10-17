import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  addMoney,
  subtractMoney,
  validateAmount,
} from '@/shared/money/decimal';
import { currencyScale } from '@/shared/money/currency';
import { decimalPrecision } from '@/shared/precision';
export const budgetMonth = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export const budgetCurrency = z.string().refine((value) => {
  try {
    currencyScale(value);
    return true;
  } catch {
    return false;
  }
}, 'Неизвестная валюта');
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const budgetInput = z
  .strictObject({
    month: budgetMonth,
    currency: budgetCurrency,
    plannedIncome: amount,
    categoryLimits: z.array(z.strictObject({ categoryId: z.uuid(), amount })),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const row of input.categoryLimits) {
      if (seen.has(row.categoryId))
        ctx.addIssue({
          code: 'custom',
          path: ['categoryLimits'],
          message: 'Категория повторяется',
        });
      seen.add(row.categoryId);
    }
    for (const value of [
      input.plannedIncome,
      ...input.categoryLimits.map((l) => l.amount),
    ])
      try {
        validateAmount(value, input.currency);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['plannedIncome'],
          message: 'Проверьте масштаб сумм',
        });
      }
  });
export type BudgetInput = z.infer<typeof budgetInput>;
export type BudgetPlan = {
  id: string;
  workspaceId: string;
  month: string;
  currency: string;
  plannedIncome: string;
  version: string;
  categoryLimits: BudgetInput['categoryLimits'];
};
export function calculateBudget(
  currency: string,
  plannedIncome: string,
  limits: BudgetInput['categoryLimits'],
  expenses: readonly {
    categoryId: string | null;
    currency: string;
    amount: string;
  }[],
) {
  const rows = expenses.filter((e) => e.currency === currency);
  const plannedExpenses = addMoney(
    limits.map((l) => l.amount),
    currency,
  );
  const actual = addMoney(
    rows.map((e) => e.amount),
    currency,
  );
  const categories = [
    ...new Set([
      ...limits.map((l) => l.categoryId),
      ...rows.flatMap((e) => (e.categoryId ? [e.categoryId] : [])),
    ]),
  ].map((categoryId) => {
    const plan = limits.find((l) => l.categoryId === categoryId);
    const fact = addMoney(
      rows.filter((e) => e.categoryId === categoryId).map((e) => e.amount),
      currency,
    );
    const limit = plan ? validateAmount(plan.amount, currency) : null;
    const D = Decimal.clone({
      precision: decimalPrecision([fact, limit ?? '0'], 'division'),
      rounding: Decimal.ROUND_HALF_UP,
    });
    return {
      categoryId,
      limit,
      actual: fact,
      remaining: limit === null ? null : subtractMoney(limit, fact, currency),
      percent:
        limit !== null && new D(limit).gt('0')
          ? new D(fact).div(limit).times('100').toFixed(2)
          : null,
      exceeded: limit !== null && new D(fact).gt(limit),
    };
  });
  return {
    plannedExpenses,
    plannedRemainder: subtractMoney(plannedIncome, plannedExpenses, currency),
    actual,
    remaining: subtractMoney(plannedExpenses, actual, currency),
    categories,
  };
}
