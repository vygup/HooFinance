import 'server-only';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { commandEnvelope } from '@/shared/contracts/commands';
import { savingsAccountSelection } from './savings-account-input';
import { projectSavingsAccount } from '../infrastructure/savings-account-repository';
/** Preview is read-only and includes current-revision account history before goal creation. */
export async function readSavingsAccount(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  const scope = commandEnvelope.shape.workspaceId.parse(workspaceId);
  const selection = savingsAccountSelection.parse(input);
  return readWorkspaceSnapshot(headers, scope, ({ tx, actorId }) =>
    projectSavingsAccount(tx, selection.accountId, scope, actorId),
  );
}
