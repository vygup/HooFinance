'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { historyCommand } from '../application/history-corrections';
export async function historyCorrectionAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await historyCommand(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    revalidatePath('/w/[workspaceId]', 'layout');
  }
  return result;
}
