import { z } from 'zod';
import { dateOnly } from '@/shared/calendar/calendar';
const date = z.string().refine((value) => {
  try {
    dateOnly(value);
    return true;
  } catch {
    return false;
  }
}, 'Проверьте дату');
export const analyticsInput = z.union([
  z.strictObject({ period: z.enum(['current', 'previous', 'year']) }),
  z
    .strictObject({ period: z.literal('custom'), from: date, until: date })
    .refine((v) => v.from <= v.until, {
      path: ['until'],
      message: 'Конец периода раньше начала',
    }),
]);
export type AnalyticsInput = z.infer<typeof analyticsInput>;
