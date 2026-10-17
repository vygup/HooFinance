import 'server-only';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/server/auth/auth';
import { currentActor, AccessError } from '@/server/security/access';
import { readSnapshot } from '@/server/db/read-snapshot';
import { workspace } from '@/server/db/schema/workspaces';
import { validationErrors } from '@/shared/contracts/commands';
import { registrationInput, profileInput } from './registration-input';
import {
  findProfile,
  saveProfile,
} from '../infrastructure/registration-repository';
export async function register(headers: Headers, input: unknown) {
  const parsed = registrationInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  // Better Auth's runWithTransaction binds user/account/session and provisioning to one tx.
  return getAuth().api.signUpEmail({
    headers,
    body: parsed.data,
    asResponse: true,
  });
}
export async function readProfile(headers: Headers) {
  const actorId = await currentActor(headers);
  return readSnapshot((tx) => findProfile(actorId, tx));
}
export async function updateProfile(headers: Headers, input: unknown) {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  try {
    return await saveProfile(await currentActor(headers), parsed.data);
  } catch (error) {
    if (error instanceof AccessError)
      return { status: 'unauthorized' as const };
    throw error;
  }
}
export async function personalDashboard(headers: Headers) {
  const actorId = await currentActor(headers);
  return readSnapshot(async (tx) => {
    const [scope] = await tx
      .select({ id: workspace.id, name: workspace.name, kind: workspace.kind })
      .from(workspace)
      .where(eq(workspace.personalOwnerId, actorId));
    if (!scope || scope.kind !== 'personal') throw new AccessError();
    return scope;
  });
}
