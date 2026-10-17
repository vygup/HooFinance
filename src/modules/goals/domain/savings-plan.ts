import { z } from 'zod';
import Decimal from 'decimal.js';
import {
  dateOnly,
  remainingMonthlySchedule,
  monthlyForecastDate,
} from '@/shared/calendar/calendar';
import { divideMoney, validateAmount } from '@/shared/money/decimal';
import { decimalPrecision } from '@/shared/precision';
export const savingsPlanInput = z.strictObject({
  command: z.literal('configureSavings'),
  goalId: z.uuid(),
  anchorDate: z.string().refine((v) => {
    try {
      dateOnly(v);
      return true;
    } catch {
      return false;
    }
  }),
  monthlyContribution: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
    .optional(),
});
export type SavingsPlanInput = z.infer<typeof savingsPlanInput>;
export function savingsProjection(input: {
  currency: string;
  remaining: string;
  status: string;
  today: string;
  targetDate: string | null;
  anchorDate: string;
  monthlyContribution: string | null;
}) {
  const remaining = validateAmount(input.remaining, input.currency);
  const contribution =
    input.monthlyContribution === null
      ? null
      : validateAmount(input.monthlyContribution, input.currency);
  const D = Decimal.clone({
    precision: decimalPrecision([remaining, contribution ?? '0'], 'division'),
  });
  const schedule = remainingMonthlySchedule(
    input.anchorDate,
    input.today,
    input.targetDate,
  );
  const state =
    input.status === 'no_obligation'
      ? 'no_obligation'
      : new D(remaining).isZero()
        ? 'reached'
        : input.targetDate === null
          ? 'no_deadline'
          : input.targetDate < input.today
            ? 'expired'
            : schedule.count === '0'
              ? 'no_dates'
              : 'scheduled';
  const recommendation =
    state === 'reached'
      ? validateAmount('0', input.currency)
      : state === 'scheduled'
        ? divideMoney(remaining, schedule.count, input.currency, 'ceil')
        : null;
  const forecastCount =
    contribution !== null &&
    new D(contribution).gt('0') &&
    new D(remaining).gt('0') &&
    state !== 'no_obligation'
      ? new D(remaining).div(contribution).ceil().toFixed(0)
      : null;
  const forecastDate =
    forecastCount === null
      ? null
      : monthlyForecastDate(input.anchorDate, schedule.first, forecastCount);
  return {
    state,
    remaining,
    count: schedule.count,
    nextDate: schedule.nextDate,
    recommendation,
    forecastDate,
    late:
      forecastDate !== null &&
      input.targetDate !== null &&
      forecastDate > input.targetDate,
    forecastOutOfRange: forecastCount !== null && forecastDate === null,
  };
}
export type SavingsPlanDto = {
  workspaceId: string;
  goalId: string;
  anchorDate: string;
  anchorDay: string;
  monthlyContribution: string | null;
  version: string;
  configured: boolean;
  today: string;
  projection: ReturnType<typeof savingsProjection>;
};
