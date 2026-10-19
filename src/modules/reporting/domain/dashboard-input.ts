import { z } from 'zod';
import { commandEnvelope } from '@/shared/contracts/commands';
import { dateOnly } from '@/shared/calendar/calendar';
const date = z.string().refine((value) => {
  try {
    dateOnly(value);
    return true;
  } catch {
    return false;
  }
}, 'Проверьте дату');
export const dashboardInput = z
  .strictObject({
    workspaceId: commandEnvelope.shape.workspaceId,
    from: date.optional(),
    until: date.optional(),
  })
  .refine(
    (value) =>
      (value.from === undefined && value.until === undefined) ||
      (value.from !== undefined &&
        value.until !== undefined &&
        value.from <= value.until),
    'Укажите обе границы интервала платежей в правильном порядке',
  );
export type DashboardInput = z.infer<typeof dashboardInput>;
