import 'server-only';
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import {
  financialAction,
  actionRevision,
  ledgerLeg,
  transferDetail,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import { financialAccount } from '@/server/db/schema/accounts';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { validateAmount } from '@/shared/money/decimal';
import type {
  HistoryAction,
  HistoryFilters,
  HistoryLeg,
} from '../domain/history-corrections';

export const historyLeg = (l: typeof ledgerLeg.$inferSelect): HistoryLeg => ({
  workspaceId: l.workspaceId,
  accountId: l.accountId,
  categoryId: l.categoryId,
  role: l.role,
  amount: validateAmount(l.amount, l.currency),
  currency: l.currency,
  financialDate: l.financialDate,
  description: l.privateDescription ?? '',
});
export async function currentAction(tx: Transaction, id: string) {
  const [action] = await tx
    .select()
    .from(financialAction)
    .where(eq(financialAction.id, id));
  if (!action) throw new AccessError();
  const legs = await tx
    .select()
    .from(ledgerLeg)
    .where(
      and(
        eq(ledgerLeg.actionId, id),
        eq(ledgerLeg.revisionNo, action.currentRevision),
      ),
    )
    .orderBy(ledgerLeg.role);
  if (!legs.length) throw new AccessError();
  return { action, legs };
}
async function mayEdit(tx: Transaction, actorId: string, legs: HistoryLeg[]) {
  const ids = [...new Set(legs.map((l) => l.workspaceId))];
  try {
    const scopes = [];
    for (const id of ids)
      scopes.push(await requireWorkspace(actorId, id, 'write', tx));
    return (
      ids.length === 1 ||
      (ids.length === 2 &&
        scopes.some(
          (s) => s.kind === 'personal' && s.personalOwnerId === actorId,
        ) &&
        scopes.some((s) => s.kind === 'family'))
    );
  } catch (error) {
    if (error instanceof AccessError) return false;
    throw error;
  }
}
export async function projectHistoryAction(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
): Promise<HistoryAction> {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const { action, legs } = await currentAction(tx, id);
  const own = legs.filter((l) => l.workspaceId === workspaceId).map(historyLeg);
  if (!own.length) throw new AccessError();
  const canEdit =
    action.status === 'active' &&
    (await mayEdit(tx, actorId, legs.map(historyLeg)));
  const revisions = await tx
    .select({ revision: actionRevision, leg: ledgerLeg })
    .from(actionRevision)
    .innerJoin(
      ledgerLeg,
      and(
        eq(ledgerLeg.actionId, actionRevision.actionId),
        eq(ledgerLeg.revisionNo, actionRevision.revisionNo),
      ),
    )
    .where(
      and(
        eq(actionRevision.actionId, id),
        eq(ledgerLeg.workspaceId, workspaceId),
      ),
    )
    .orderBy(actionRevision.revisionNo, ledgerLeg.role);
  const history: HistoryAction['revisions'] = [];
  for (const { revision: r, leg } of revisions) {
    let row = history.find((h) => h.revision === String(r.revisionNo));
    if (!row) {
      row = {
        revision: String(r.revisionNo),
        status: r.status,
        actorId: r.actorId,
        happenedAt: r.happenedAt.toISOString(),
        legs: [],
      };
      history.push(row);
    }
    row.legs.push(historyLeg(leg));
  }
  return {
    id,
    workspaceId,
    kind: action.kind,
    creatorId: action.creatorId,
    createdAt: action.createdAt.toISOString(),
    version: action.version.toString(),
    status: action.status,
    canEdit,
    legs: own,
    editLegs: canEdit ? legs.map(historyLeg) : [],
    revisions: history,
  };
}
export async function historyInSnapshot(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  filters: HistoryFilters,
) {
  const conditions = [eq(ledgerLeg.workspaceId, workspaceId)];
  if (filters.from) conditions.push(gte(ledgerLeg.financialDate, filters.from));
  if (filters.to) conditions.push(lte(ledgerLeg.financialDate, filters.to));
  if (filters.accountId)
    conditions.push(eq(ledgerLeg.accountId, filters.accountId));
  if (filters.categoryId)
    conditions.push(eq(ledgerLeg.categoryId, filters.categoryId));
  // POSITION implements literal, case-insensitive substring search: % and _ are not wildcards.
  if (filters.text)
    conditions.push(
      sql`position(lower(${filters.text}) in lower(coalesce(${ledgerLeg.privateDescription},''))) > 0`,
    );
  const rows = await tx
    .select({ id: financialAction.id })
    .from(ledgerLeg)
    .innerJoin(
      financialAction,
      and(
        eq(financialAction.id, ledgerLeg.actionId),
        eq(financialAction.currentRevision, ledgerLeg.revisionNo),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      desc(ledgerLeg.financialDate),
      desc(financialAction.createdAt),
      financialAction.id,
    );
  const actions: HistoryAction[] = [];
  for (const id of new Set(rows.map((r) => r.id)))
    actions.push(await projectHistoryAction(tx, id, workspaceId, actorId));
  return actions;
}
export async function saveCorrection(
  tx: Transaction,
  actorId: string,
  operationKey: string,
  action: typeof financialAction.$inferSelect,
  before: HistoryLeg[],
  after: HistoryLeg[],
  balances: { accountId: string; amount: string; currency: string }[],
  deleting: boolean,
) {
  const revisionNo = action.currentRevision + 1;
  const status = deleting ? 'deleted' : 'active';
  await tx
    .insert(actionRevision)
    .values({ actionId: action.id, revisionNo, actorId, status });
  const saved = await tx
    .insert(ledgerLeg)
    .values(
      after.map((l) => ({
        actionId: action.id,
        revisionNo,
        workspaceId: l.workspaceId,
        accountId: l.accountId,
        categoryId: l.categoryId,
        role: l.role,
        currency: l.currency,
        amount: l.amount,
        financialDate: l.financialDate,
        privateDescription: l.description,
      })),
    )
    .returning();
  if (action.kind === 'transfer') {
    const source = saved.find((l) => l.role === 'transfer_out')!,
      destination = saved.find((l) => l.role === 'transfer_in')!;
    const [previous] = await tx
      .select()
      .from(transferDetail)
      .where(
        and(
          eq(transferDetail.actionId, action.id),
          eq(transferDetail.revisionNo, action.currentRevision),
        ),
      );
    if (!previous) throw Error('TRANSFER_DETAIL_MISSING');
    await tx.insert(transferDetail).values({
      actionId: action.id,
      revisionNo,
      sourceLegId: source.id,
      destinationLegId: destination.id,
      rateNumerator: source.amount,
      rateDenominator: destination.amount,
      rateDecimal: previous.rateDecimal,
      rateDirection: previous.rateDirection,
    });
  }
  await tx
    .update(financialAction)
    .set({ currentRevision: revisionNo, status, version: action.version + 1n })
    .where(eq(financialAction.id, action.id));
  for (const b of balances)
    await tx
      .update(financialAccount)
      .set({
        balanceProjection: b.amount,
        version: sql`${financialAccount.version}+1`,
      })
      .where(eq(financialAccount.id, b.accountId));
  for (const workspaceId of new Set(before.map((l) => l.workspaceId))) {
    const scoped = (legs: HistoryLeg[], version: string, state: string) => ({
      version,
      status: state,
      legs: legs.filter((l) => l.workspaceId === workspaceId),
    });
    await tx.insert(scopedAuditEvent).values({
      workspaceId,
      objectType: action.kind,
      objectId: action.id,
      actorId,
      revisionNo,
      kind: deleting ? 'delete' : 'update',
      beforeScope: scoped(before, action.version.toString(), action.status),
      afterScope: scoped(after, (action.version + 1n).toString(), status),
    });
  }
  await tx
    .update(commandReceipt)
    .set({ actionId: action.id })
    .where(
      and(
        eq(commandReceipt.actorId, actorId),
        eq(commandReceipt.operationKey, operationKey),
      ),
    );
  return action.id;
}
