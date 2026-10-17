import { z } from 'zod';
export const commandEnvelope = z.strictObject({
  workspaceId: z.uuid(),
  operationKey: z.uuid(),
  expectedVersion: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
  confirmationToken: z.string().min(1).optional(),
});
export type CommandEnvelope = z.infer<typeof commandEnvelope>;
export type CommandResult<T> =
  | { status: 'success'; data: T }
  | { status: 'validation'; fieldErrors: Record<string, string[]> }
  | {
      status:
        'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';
    }
  | {
      status: 'confirmation_required';
      confirmationToken: string;
      balances: readonly {
        accountId: string;
        amount: string;
        currency: string;
      }[];
    };
export function validationErrors(error: z.ZodError) {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (fields[key] ??= []).push('Проверьте значение поля');
  }
  return { status: 'validation' as const, fieldErrors: fields };
}
