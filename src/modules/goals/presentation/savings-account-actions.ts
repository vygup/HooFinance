'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { AccessError } from '@/server/security/access';
import { correlationId, logError } from '@/server/security/logging';
import {
  validationErrors,
  type CommandResult,
} from '@/shared/contracts/commands';
import { readSavingsAccount } from '../application/savings-account';
import type { SavingsAccountDto } from '../domain/savings-account';
export async function savingsAccountHistoryAction(
  workspaceId: string,
  input: unknown,
): Promise<CommandResult<SavingsAccountDto>> {
  try {
    return {
      status: 'success',
      data: await readSavingsAccount(
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
