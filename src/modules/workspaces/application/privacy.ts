import 'server-only';
import { currentActor, AccessError } from '@/server/security/access';
import { readSnapshot } from '@/server/db/read-snapshot';
import { privacyInput } from './privacy-input';
import { privacyScope } from '../infrastructure/privacy-repository';
/** Recheck access on each request, including after a form has been opened. */
export async function readPrivacy(headers: Headers, input: unknown) {
  const parsed = privacyInput.safeParse(input);
  if (!parsed.success) throw new AccessError();
  const actorId = await currentActor(headers);
  return readSnapshot((tx) =>
    privacyScope(tx, actorId, parsed.data.workspaceId),
  );
}
