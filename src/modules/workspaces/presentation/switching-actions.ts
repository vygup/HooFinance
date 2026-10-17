'use server';
import { headers } from 'next/headers';
import { selectSpace, setFamilyTimezone } from '../application/switching';
import { AccessError } from '@/server/security/access';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { revalidatePath } from 'next/cache';
export async function switchSpaceAction(input: unknown) {
  try {
    const data = await selectSpace(new Headers(await headers()), input);
    return { status: 'success' as const, data };
  } catch (error) {
    if (error instanceof AccessError) return { status: 'forbidden' as const };
    return { status: 'unavailable' as const };
  }
}
export async function setFamilyTimezoneAction(
  envelope: CommandEnvelope,
  input: unknown,
) {
  const result = await setFamilyTimezone(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    revalidatePath(`/w/${envelope.workspaceId}`, 'layout');
    revalidatePath('/', 'layout');
    revalidatePath('/families');
  }
  return result;
}
