import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import {
  financialAction,
  actionRevision,
  ledgerLeg,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { validateAmount } from '@/shared/money/decimal';
import type { IncomeInput, IncomeDto } from '../domain/income';
export async function incomeCategory(
  tx: Transaction,
  workspaceId: string,
  choice: IncomeInput['category'],
  actorId: string,
  kind: 'income' | 'expense' = 'income',
) {
  if ('id' in choice) {
    const [row] = await tx
      .select()
      .from(category)
      .where(
        and(
          eq(category.id, choice.id),
          eq(category.workspaceId, workspaceId),
          eq(category.kind, kind),
          isNull(category.archivedAt),
        ),
      )
      .for('update');
    if (!row) throw new AccessError();
    return row.id;
  }
  const [row] = await tx
    .insert(category)
    .values({ workspaceId, kind, name: choice.name })
    .returning();
  if (!row) throw new Error('WRITE_FAILED');
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: 'category',
    objectId: row.id,
    actorId,
    revisionNo: 1,
    kind: 'create',
    beforeScope: null,
    afterScope: { id: row.id, name: row.name, kind: row.kind, version: '1' },
  });
  return row.id;
}
export async function saveIncome(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  operationKey: string,
  account: typeof financialAccount.$inferSelect,
  input: IncomeInput,
  categoryId: string,
  accepted: { amount: string; balance: string },
  kind: 'income' | 'expense' = 'income',
) {
  const [action] = await tx
    .insert(financialAction)
    .values({
      creatorId: actorId,
      kind,
      currentRevision: 1,
      status: 'active',
    })
    .returning();
  if (!action) throw new Error('WRITE_FAILED');
  await tx
    .insert(actionRevision)
    .values({ actionId: action.id, revisionNo: 1, actorId, status: 'active' });
  await tx.insert(ledgerLeg).values({
    workspaceId,
    actionId: action.id,
    revisionNo: 1,
    accountId: account.id,
    role: kind,
    amount: accepted.amount,
    currency: account.currency,
    financialDate: input.financialDate,
    categoryId,
    privateDescription: input.description,
  });
  await tx
    .update(financialAccount)
    .set({ balanceProjection: accepted.balance, version: account.version + 1n })
    .where(
      and(
        eq(financialAccount.id, account.id),
        eq(financialAccount.workspaceId, workspaceId),
      ),
    );
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: kind,
    objectId: action.id,
    actorId,
    revisionNo: 1,
    kind: 'create',
    beforeScope: null,
    afterScope: {
      accountId: account.id,
      categoryId,
      amount: accepted.amount,
      currency: account.currency,
      financialDate: input.financialDate,
      description: input.description,
      version: '1',
    },
  });
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
export async function projectIncome(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
  kind: 'income' | 'expense' = 'income',
): Promise<IncomeDto> {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select({ leg: ledgerLeg, action: financialAction })
    .from(ledgerLeg)
    .innerJoin(
      financialAction,
      and(
        eq(financialAction.id, ledgerLeg.actionId),
        eq(financialAction.currentRevision, ledgerLeg.revisionNo),
        eq(financialAction.status, 'active'),
        eq(financialAction.kind, kind),
      ),
    )
    .where(
      and(
        eq(ledgerLeg.workspaceId, workspaceId),
        eq(ledgerLeg.actionId, id),
        eq(ledgerLeg.role, kind),
      ),
    );
  if (!row || !row.leg.categoryId) throw new AccessError();
  return {
    id,
    workspaceId,
    accountId: row.leg.accountId,
    categoryId: row.leg.categoryId,
    amount: validateAmount(row.leg.amount, row.leg.currency),
    currency: row.leg.currency,
    financialDate: row.leg.financialDate,
    description: row.leg.privateDescription ?? '',
    version: row.action.version.toString(),
  };
}
