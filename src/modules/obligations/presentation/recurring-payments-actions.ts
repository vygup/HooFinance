'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import {
  obligationCommand,
  confirmPayment,
} from '../application/recurring-payments';
function refresh(workspaceId: string) {
  for (const section of [
    'obligations',
    'goals',
    'accounts',
    'operations',
    'dashboard',
  ])
    revalidatePath(`/w/${workspaceId}/${section}`);
  revalidatePath('/dashboard');
}
export async function recurringPaymentAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await obligationCommand(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') refresh(envelope.workspaceId);
  return result;
}
export async function confirmPaymentAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await confirmPayment(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') refresh(envelope.workspaceId);
  return result;
}
