import { z } from 'zod';
import { currencyScale } from '@/shared/money/currency';
import { validateAmount } from '@/shared/money/decimal';
export const accountType = z.enum([
  'cash',
  'bank_card',
  'accumulation',
  'savings',
  'reserve',
  'other',
]);
const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).default('');
const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const accountInput = z.discriminatedUnion('command', [
  z
    .strictObject({
      command: z.literal('create'),
      name,
      type: accountType,
      currency: z.string().refine((value) => {
        try {
          currencyScale(value);
          return true;
        } catch {
          return false;
        }
      }),
      openingBalance: decimalString,
      description,
    })
    .superRefine((value, ctx) => {
      try {
        validateAmount(value.openingBalance, value.currency);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['openingBalance'],
          message: 'Проверьте сумму и валюту',
        });
      }
    }),
  z.strictObject({
    command: z.literal('update'),
    accountId: z.uuid(),
    name,
    type: accountType,
    description,
  }),
  z.strictObject({ command: z.literal('archive'), accountId: z.uuid() }),
  z.strictObject({
    command: z.literal('correctOpening'),
    accountId: z.uuid(),
    openingBalance: decimalString,
    explicitConfirmation: z.literal(true),
  }),
]);
