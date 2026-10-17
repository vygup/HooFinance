import 'server-only';
import { getDb, type Transaction } from './client';
export function readSnapshot<T>(read: (tx: Transaction) => Promise<T>) {
  return getDb().transaction(read, {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

export async function readWorkspaceSnapshot<T>(
  headers: Headers,
  workspaceId: string,
  read: (context: { tx: Transaction; actorId: string }) => Promise<T>,
  mode: 'read' | 'history' = 'read',
) {
  const { currentActor, requireWorkspace } =
    await import('@/server/security/access');
  const actorId = await currentActor(headers);
  return readSnapshot(async (tx) => {
    await requireWorkspace(actorId, workspaceId, mode, tx);
    return read({ tx, actorId });
  });
}
