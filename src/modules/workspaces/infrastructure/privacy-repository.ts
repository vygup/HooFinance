import 'server-only';
import type { Transaction } from '@/server/db/client';
import { requireWorkspace } from '@/server/security/access';
export async function privacyScope(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
) {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  // Return no names, ownership, membership, balances or raw database records.
  return { workspaceId };
}
