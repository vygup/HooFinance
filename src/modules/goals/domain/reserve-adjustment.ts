import { z } from 'zod';
import { goalProgress } from './reserve';
export const reserveAdjustmentInput = z.strictObject({
  command: z.literal('adjustReserve'),
  goalId: z.uuid(),
  monthlyAmount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  coverageMonths: z.string().regex(/^[1-9]\d*$/),
});
export type ReserveAdjustmentInput = z.infer<typeof reserveAdjustmentInput>;
export function adjustedReserveProgress(
  currency: string,
  balance: string,
  input: ReserveAdjustmentInput,
) {
  const terms = reserveAdjustmentInput.parse(input);
  return goalProgress(currency, balance, {
    type: 'reserve',
    monthlyAmount: terms.monthlyAmount,
    coverageMonths: terms.coverageMonths,
  });
}
