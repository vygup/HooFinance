'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { configureSavings } from '../application/savings-plan';
export async function savingsPlanAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await configureSavings(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success')
    revalidatePath(`/w/${result.data.workspaceId}/goals`);
  return result;
}

import { z } from 'zod';
import { AccessError } from '@/server/security/access';
import { correlationId, logError } from '@/server/security/logging';
import {
  validationErrors,
  type CommandResult,
} from '@/shared/contracts/commands';
import type { SavingsPlanDto } from '../domain/savings-plan';
import { previewSavings } from '../application/savings-plan';
export async function savingsPlanPreviewAction(
  workspaceId: string,
  input: unknown,
): Promise<CommandResult<SavingsPlanDto['projection']>> {
  try {
    return {
      status: 'success',
      data: await previewSavings(
        new Headers(await headers()),
        workspaceId,
        input,
      ),
    };
  } catch (error) {
    if (error instanceof z.ZodError) return validationErrors(error);
    if (error instanceof AccessError)
      return {
        status: error.code === 'UNAUTHORIZED' ? 'unauthorized' : 'forbidden',
      };
    logError('DATABASE_ERROR', { correlationId: correlationId() });
    return { status: 'unavailable' };
  }
}
