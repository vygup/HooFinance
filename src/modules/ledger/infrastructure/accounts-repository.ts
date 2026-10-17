import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  financialAction,
  ledgerLeg,
  scopedAuditEvent,
} from '@/server/db/schema/ledger';
import { AccessError, requireWorkspace } from '@/server/security/access';
import { historyBalances, type AccountDto } from '../domain/accounts';
import { validateAmount } from '@/shared/money/decimal';
export type AccountRow = typeof financialAccount.$inferSelect;
export function accountSnapshot(row: AccountRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalance: validateAmount(row.openingBalance, row.currency),
    balance: validateAmount(row.balanceProjection, row.currency),
    description: row.description ?? '',
    archived: row.archivedAt !== null,
    version: row.version.toString(),
  };
}
export async function projectAccount(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
): Promise<AccountDto> {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select()
    .from(financialAccount)
    .where(
      and(
        eq(financialAccount.id, id),
        eq(financialAccount.workspaceId, workspaceId),
      ),
    );
  if (!row) throw new AccessError();
  const legs = await tx
    .select({
      id: ledgerLeg.id,
      date: ledgerLeg.financialDate,
      role: ledgerLeg.role,
      amount: ledgerLeg.amount,
      description: ledgerLeg.privateDescription,
    })
    .from(ledgerLeg)
    .innerJoin(
      financialAction,
      and(
        eq(financialAction.id, ledgerLeg.actionId),
        eq(financialAction.currentRevision, ledgerLeg.revisionNo),
        eq(financialAction.status, 'active'),
      ),
    )
    .where(
      and(eq(ledgerLeg.workspaceId, workspaceId), eq(ledgerLeg.accountId, id)),
    )
    .orderBy(
      asc(ledgerLeg.financialDate),
      asc(financialAction.createdAt),
      asc(ledgerLeg.id),
    );
  const balances = historyBalances(row.openingBalance, row.currency, legs);
  const audit = await tx
    .select()
    .from(scopedAuditEvent)
    .where(
      and(
        eq(scopedAuditEvent.workspaceId, workspaceId),
        eq(scopedAuditEvent.objectType, 'account'),
        eq(scopedAuditEvent.objectId, id),
      ),
    )
    .orderBy(scopedAuditEvent.occurredAt, scopedAuditEvent.id);
  return {
    ...accountSnapshot(row),
    history: legs.map((leg, i) => ({
      ...leg,
      amount: validateAmount(leg.amount, row.currency),
      description: leg.description ?? '',
      balance: balances[i]!,
    })),
    audit: audit.map((event) => ({
      id: event.id,
      kind: event.kind,
      actorId: event.actorId,
      occurredAt: event.occurredAt.toISOString(),
      before: event.beforeScope,
      after: event.afterScope,
    })),
  };
}
export async function saveAccount(
  tx: Transaction,
  actorId: string,
  kind: string,
  before: AccountRow | undefined,
  after: AccountRow,
) {
  await tx.insert(scopedAuditEvent).values({
    workspaceId: after.workspaceId,
    objectType: 'account',
    objectId: after.id,
    actorId,
    revisionNo: 1,
    kind,
    beforeScope: before ? accountSnapshot(before) : null,
    afterScope: accountSnapshot(after),
  });
}
