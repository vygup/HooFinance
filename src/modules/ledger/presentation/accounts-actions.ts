'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { accountCommand } from '../application/accounts';
import type { CommandEnvelope } from '@/shared/contracts/commands';
export async function accountAction(envelope: CommandEnvelope, input: unknown) {
  const result = await accountCommand(
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
