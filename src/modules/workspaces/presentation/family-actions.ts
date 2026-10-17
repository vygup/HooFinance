'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  createFamily,
  familyCommand,
  respondFamilyInvitation,
} from '../application/family';
import type { CommandEnvelope } from '@/shared/contracts/commands';
export async function createFamilyAction(input: unknown) {
  const result = await createFamily(new Headers(await headers()), input);
  if (result.status === 'success') {
    revalidatePath('/', 'layout');
    revalidatePath('/families');
    revalidatePath('/dashboard');
  }
  return result;
}
export async function familyAction(envelope: CommandEnvelope, input: unknown) {
  const result = await familyCommand(
    new Headers(await headers()),
    envelope,
    input,
  );
  if (result.status === 'success') {
    revalidatePath('/', 'layout');
    revalidatePath('/families');
    revalidatePath('/dashboard');
  }
  return result;
}
export async function invitationAction(input: unknown) {
  const result = await respondFamilyInvitation(
    new Headers(await headers()),
    input,
  );
  if (result.status === 'success') {
    revalidatePath('/', 'layout');
    revalidatePath('/families');
    revalidatePath('/dashboard');
  }
  return result;
}
