import { z } from 'zod';
import { commandEnvelope } from '@/shared/contracts/commands';
export const privacyInput = z.strictObject({
  workspaceId: commandEnvelope.shape.workspaceId,
});
