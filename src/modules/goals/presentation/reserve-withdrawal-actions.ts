'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { withdrawReserve } from '../application/reserve-withdrawal';
import { reserveWithdrawalInput } from '../domain/reserve-withdrawal';
export async function reserveWithdrawalAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await withdrawReserve(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    const p = reserveWithdrawalInput.parse(input);
    const scopes =
      p.kind === 'transfer'
        ? [p.sourceWorkspaceId, p.destinationWorkspaceId]
        : [envelope.workspaceId];
    for (const id of new Set(scopes))
      for (const page of ['accounts', 'goals', 'budget'])
        revalidatePath(`/w/${id}/${page}`);
  }
  return result;
}
