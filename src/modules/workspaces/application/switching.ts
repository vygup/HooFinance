import 'server-only';
import { currentActor, AccessError } from '@/server/security/access';
import { readSnapshot } from '@/server/db/read-snapshot';
import type { CommandEnvelope } from '@/shared/contracts/commands';
import { validationErrors } from '@/shared/contracts/commands';
import { readFamilies, familyCommand } from './family';
import { switchingInput, familyTimezoneInput } from './switching-input';
import { selectedSpace } from '../infrastructure/switching-repository';
import { switchingTarget } from '../domain/switching';
export async function readSpaces(headers: Headers) {
  const { active, deleted } = await readFamilies(headers);
  const valid = (spaces: typeof active) =>
    spaces.filter(
      (s): s is typeof s & { kind: 'personal' | 'family' } =>
        s.kind === 'personal' || s.kind === 'family',
    );
  return { active: valid(active), deleted: valid(deleted) };
}
export async function selectSpace(
  headers: Headers,
  input: unknown,
  instant = new Date(),
) {
  const parsed = switchingInput.safeParse(input);
  if (!parsed.success) throw new AccessError();
  const actorId = await currentActor(headers);
  return readSnapshot(async (tx) => {
    const space = await selectedSpace(
      tx,
      actorId,
      parsed.data.workspaceId,
      instant,
    );
    return {
      ...space,
      href: switchingTarget(
        space.id,
        space.readonly,
        `/w/${space.id}/${parsed.data.section}`,
      ),
    };
  });
}
export async function setFamilyTimezone(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const parsed = familyTimezoneInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  return familyCommand(headers, envelope, {
    command: 'timezone',
    timezone: parsed.data.timezone,
  });
}
