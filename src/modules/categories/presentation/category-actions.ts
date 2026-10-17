'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { categoryCommand } from '../application/expenses';
export async function categoryAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await categoryCommand(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success')
    revalidatePath(`/w/${result.data.workspaceId}/accounts`);
  return result;
}
