import { z } from 'zod';
const name = z.string().trim().min(1, 'Введите название').max(100);
export const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((v) => {
    try {
      if (/^[+-]/.test(v)) return false;
      new Intl.DateTimeFormat('ru-RU', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Укажите часовой пояс IANA');
export const createFamilyInput = z.strictObject({
  name,
  timezone: timezone.optional(),
  operationKey: z.uuid(),
});
export const familyInput = z.discriminatedUnion('command', [
  z.strictObject({ command: z.literal('rename'), name }),
  z.strictObject({ command: z.literal('timezone'), timezone }),
  z.strictObject({
    command: z.literal('invite'),
    email: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  z.strictObject({
    command: z.literal('cancelInvite'),
    invitationId: z.string().min(1).max(200),
  }),
  z.strictObject({
    command: z.literal('remove'),
    memberId: z.string().min(1).max(200),
  }),
  z.strictObject({ command: z.literal('leave') }),
  z.strictObject({
    command: z.literal('offer'),
    recipientId: z.string().min(1).max(200),
  }),
  z.strictObject({ command: z.literal('acceptOwnership'), offerId: z.uuid() }),
  z.strictObject({ command: z.literal('cancelOffer'), offerId: z.uuid() }),
  z.strictObject({
    command: z.literal('delete'),
    explicitConfirmation: z.literal(true),
  }),
]);
export const invitationResponseInput = z.strictObject({
  secret: z.string().min(1).max(2048),
  decision: z.enum(['accept', 'reject']),
  operationKey: z.uuid(),
});
export type FamilyDto = {
  id: string;
  name: string;
  timezone: string;
  version: string;
  organizationId: string;
  role: 'owner' | 'member';
  deleted: boolean;
  members: { id: string; userId: string; email: string; role: string }[];
  invitations: { id: string; email: string; status: string }[];
  offers: { id: string; recipientId: string; workspaceVersion: string }[];
};
