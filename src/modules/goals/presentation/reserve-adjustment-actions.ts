'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { adjustReserve } from '../application/reserve-adjustment';
export async function reserveAdjustmentAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await adjustReserve(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success')
    revalidatePath(`/w/${result.data.workspaceId}/goals`);
  return result;
}
