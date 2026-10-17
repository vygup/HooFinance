'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { createTransfer } from '../application/transfers';
import { transferInput } from '../application/transfers-input';
export async function transferAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await createTransfer(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    const parsed = transferInput.parse(input);
    for (const scope of new Set([
      parsed.sourceWorkspaceId,
      parsed.destinationWorkspaceId,
    ])) {
      revalidatePath(`/w/${scope}/accounts`);
      revalidatePath(`/w/${scope}/goals`);
    }
  }
  return result;
}
