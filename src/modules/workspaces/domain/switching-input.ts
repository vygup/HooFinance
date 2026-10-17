import { z } from 'zod';
import { commandEnvelope } from '@/shared/contracts/commands';
import { timezone } from './family';
export const switchingInput = z.strictObject({
  workspaceId: commandEnvelope.shape.workspaceId,
  section: z.enum(['accounts', 'budget', 'goals', 'operations']),
});
export const familyTimezoneInput = z.strictObject({ timezone });
export type { SpaceOption } from './switching';
