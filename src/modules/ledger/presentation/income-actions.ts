'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { createIncome } from '../application/income';
export async function incomeAction(envelope: CommandEnvelope, input: unknown) {
  const result = await createIncome(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    revalidatePath(`/w/${result.data.workspaceId}/accounts`);
    revalidatePath(`/w/${result.data.workspaceId}/goals`);
  }
  return result;
}
