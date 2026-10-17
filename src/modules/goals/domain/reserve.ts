import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  validateAmount,
  multiplyMoney,
  subtractMoney,
} from '@/shared/money/decimal';
import { currencyScale } from '@/shared/money/currency';
import { decimalPrecision } from '@/shared/precision';
import { dateOnly } from '@/shared/calendar/calendar';
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const common = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  accountId: z.uuid(),
  currency: z.string().refine((c) => {
    try {
      currencyScale(c);
      return true;
    } catch {
      return false;
    }
  }),
  targetDate: z
    .string()
    .refine((d) => {
      try {
        dateOnly(d);
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
};
const ordinary = z.strictObject({
  ...common,
  type: z.literal('ordinary'),
  ordinaryTarget: amount.refine((v) => {
    try {
      return new Decimal(v).gt('0');
    } catch {
      return false;
    }
  }),
});
const reserve = z.strictObject({
  ...common,
  type: z.literal('reserve'),
  monthlyAmount: amount,
  coverageMonths: z.string().regex(/^[1-9]\d*$/),
});
export const goalInput = z
  .union([
    ordinary.extend({ command: z.literal('create') }),
    reserve.extend({ command: z.literal('create') }),
    ordinary.extend({ command: z.literal('update'), id: z.uuid() }),
    reserve.extend({ command: z.literal('update'), id: z.uuid() }),
    z.strictObject({
      command: z.literal('archive'),
      id: z.uuid(),
      explicitConfirmation: z.literal(true),
    }),
  ])
  .superRefine((input, ctx) => {
    if (input.command === 'archive') return;
    try {
      validateAmount(
        input.type === 'ordinary' ? input.ordinaryTarget : input.monthlyAmount,
        input.currency,
      );
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: [input.type === 'ordinary' ? 'ordinaryTarget' : 'monthlyAmount'],
        message: 'Проверьте масштаб суммы',
      });
    }
  });
export type GoalInput = z.infer<typeof goalInput>;
export type GoalTerms =
  | { type: 'ordinary'; ordinaryTarget: string }
  | { type: 'reserve'; monthlyAmount: string; coverageMonths: string };
export function goalProgress(
  currency: string,
  balance: string,
  terms: GoalTerms,
) {
  const actual = validateAmount(balance, currency);
  const target =
    terms.type === 'ordinary'
      ? validateAmount(terms.ordinaryTarget, currency)
      : multiplyMoney(
          validateAmount(terms.monthlyAmount, currency),
          terms.coverageMonths,
          currency,
        );
  const D = Decimal.clone({
    precision: decimalPrecision(
      [actual, target, terms.type === 'reserve' ? terms.monthlyAmount : '1'],
      'division',
    ),
    rounding: Decimal.ROUND_HALF_UP,
  });
  const deficit = new D(actual).lt('0');
  if (terms.type === 'reserve' && new D(terms.monthlyAmount).isZero())
    return {
      actual,
      target,
      remaining: validateAmount('0', currency),
      percent: null,
      coverage: null,
      reached: null,
      status: 'no_obligation' as const,
      deficit,
    };
  const remaining = new D(target).gt(actual)
    ? subtractMoney(target, actual, currency)
    : validateAmount('0', currency);
  const reached = !deficit && new D(actual).gte(target);
  return {
    actual,
    target,
    remaining,
    percent: deficit ? null : new D(actual).div(target).times('100').toFixed(2),
    coverage:
      deficit || terms.type === 'ordinary'
        ? null
        : new D(actual).div(terms.monthlyAmount).toDecimalPlaces(2).toFixed(),
    reached,
    status: deficit
      ? ('deficit' as const)
      : reached
        ? ('reached' as const)
        : ('in_progress' as const),
    deficit,
  };
}
export type GoalDto = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  type: 'ordinary' | 'reserve';
  currency: string;
  accountId: string;
  accountName: string;
  ordinaryTarget: string | null;
  targetDate: string | null;
  monthlyAmount: string | null;
  coverageMonths: string | null;
  archived: boolean;
  version: string;
  progress: ReturnType<typeof goalProgress>;
};
