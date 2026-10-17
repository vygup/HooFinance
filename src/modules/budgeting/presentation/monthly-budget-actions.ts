'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { saveMonthlyBudget } from '../application/monthly-budget';
export async function monthlyBudgetAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await saveMonthlyBudget(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success')
    revalidatePath(`/w/${result.data.workspaceId}/budget`);
  return result;
}
