import { z } from 'zod';
import { dateOnly } from '@/shared/calendar/calendar';
import { validateAmount } from '@/shared/money/decimal';
export const paymentDate = z.string().refine((value) => {
  try {
    dateOnly(value);
    return true;
  } catch {
    return false;
  }
}, 'Проверьте дату');
const fields = {
  name: z.string().trim().min(1).max(200),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  currency: z.string(),
  repeatEvery: z.number().int().positive().max(2147483647),
  repeatUnit: z.enum(['day', 'week', 'month', 'year']),
  anchorDate: paymentDate,
  categoryId: z.uuid(),
  accountId: z.uuid(),
};
export const recurringPaymentInput = z
  .union([
    z.strictObject({ ...fields, command: z.literal('create') }),
    z.strictObject({ ...fields, command: z.literal('update'), id: z.uuid() }),
    z.strictObject({
      command: z.enum(['pause', 'resume', 'archive']),
      id: z.uuid(),
    }),
    z.strictObject({
      command: z.literal('linkReserve'),
      goalId: z.uuid(),
      obligationId: z.uuid().nullable(),
    }),
  ])
  .superRefine((input, ctx) => {
    if (input.command !== 'create' && input.command !== 'update') return;
    try {
      validateAmount(input.amount, input.currency);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Проверьте сумму и валюту',
      });
    }
  });
export const confirmPaymentInput = z.strictObject({
  occurrenceId: z.uuid(),
  accountId: z.uuid(),
  actualAmount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  actualDate: paymentDate,
});
export type RecurringPaymentInput = z.infer<typeof recurringPaymentInput>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentInput>;
