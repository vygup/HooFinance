'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { fundGoal } from '../application/goal-funding';
import { goalFundingInput } from '../domain/goal-funding';
export async function goalFundingAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await fundGoal(new Headers(await headers()), envelope, input);
  if (result.status === 'success') {
    const parsed = goalFundingInput.parse(input);
    for (const id of new Set([
      parsed.sourceWorkspaceId,
      parsed.destinationWorkspaceId,
    ])) {
      revalidatePath(`/w/${id}/accounts`);
      revalidatePath(`/w/${id}/goals`);
      revalidatePath(`/w/${id}/budget`);
    }
  }
  return result;
}
