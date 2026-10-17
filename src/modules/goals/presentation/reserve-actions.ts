'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { goalCommand } from '../application/reserve';
export async function reserveAction(envelope: CommandEnvelope, input: unknown) {
  const result = await goalCommand(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    revalidatePath(`/w/${result.data.workspaceId}/goals`);
    revalidatePath(`/w/${result.data.workspaceId}/accounts`);
  }
  return result;
}
