import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { AccessError, requireWorkspace } from '@/server/security/access';
import {
  ledgerLeg,
  financialAction,
  transferDetail,
} from '@/server/db/schema/ledger';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import { encodeHistoryCsv, type HistoryRow } from '@/shared/csv/history';
export async function historyRows(
  headers: Headers,
  workspaceId: string,
): Promise<HistoryRow[]> {
  if (!z.uuid().safeParse(workspaceId).success) throw new AccessError();
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => {
      const scope = await requireWorkspace(actorId, workspaceId, 'history', tx);
      // The P1 transport is deliberately limited to the former owner's deleted-family history.
      if (
        scope.kind !== 'family' ||
        !scope.deletedAt ||
        scope.deletedBy !== actorId
      )
        throw new AccessError();
      const rows = await tx
        .select({
          leg: ledgerLeg,
          account: financialAccount.name,
          category: category.name,
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
        .innerJoin(
          financialAccount,
          and(
            eq(financialAccount.id, ledgerLeg.accountId),
            eq(financialAccount.workspaceId, workspaceId),
          ),
        )
        .leftJoin(
          category,
          and(
            eq(category.id, ledgerLeg.categoryId),
            eq(category.workspaceId, workspaceId),
          ),
        )
        .where(eq(ledgerLeg.workspaceId, workspaceId))
        .orderBy(ledgerLeg.financialDate, ledgerLeg.id);
      const result: HistoryRow[] = [];
      for (const row of rows) {
        const leg = row.leg,
          isTransfer = leg.role.startsWith('transfer_');
        const other = isTransfer
          ? rows.find(
              (r) => r.leg.actionId === leg.actionId && r.leg.id !== leg.id,
            )
          : undefined;
        const [rate] = other
          ? await tx
              .select()
              .from(transferDetail)
              .where(
                and(
                  eq(transferDetail.actionId, leg.actionId),
                  eq(transferDetail.revisionNo, leg.revisionNo),
                ),
              )
          : [];
        result.push({
          id: leg.id,
          revision: leg.revisionNo,
          type: isTransfer ? 'transfer' : leg.role,
          date: leg.financialDate,
          account: row.account,
          currency: leg.currency,
          amount: leg.amount,
          category: row.category ?? '',
          description: leg.privateDescription ?? '',
          transferId: isTransfer ? leg.actionId : '',
          direction: isTransfer
            ? leg.role === 'transfer_out'
              ? 'out'
              : 'in'
            : '',
          counterpartyAccount: other?.account ?? '',
          counterpartyCurrency: other?.leg.currency ?? '',
          counterpartyAmount: other?.leg.amount ?? '',
          rateNumerator: rate?.rateNumerator ?? '',
          rateDenominator: rate?.rateDenominator ?? '',
        });
      }
      return result;
    },
    'history',
  );
}
export async function exportHistory(headers: Headers, id: string) {
  return encodeHistoryCsv(await historyRows(headers, id));
}
