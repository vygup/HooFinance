import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { financialAccount } from '@/server/db/schema/accounts';
import {
  financialAction,
  actionRevision,
  ledgerLeg,
  transferDetail,
  scopedAuditEvent,
  commandReceipt,
} from '@/server/db/schema/ledger';
import { requireWorkspace, AccessError } from '@/server/security/access';
import { projectLeg } from '@/server/security/projection';
import { validateAmount } from '@/shared/money/decimal';
import type {
  TransferInput,
  TransferDto,
  acceptTransfer,
} from '../domain/transfers';
export async function saveTransfer(
  tx: Transaction,
  actorId: string,
  operationKey: string,
  source: typeof financialAccount.$inferSelect,
  destination: typeof financialAccount.$inferSelect,
  input: TransferInput,
  accepted: ReturnType<typeof acceptTransfer>,
) {
  const [action] = await tx
    .insert(financialAction)
    .values({
      creatorId: actorId,
      kind: 'transfer',
      currentRevision: 1,
      status: 'active',
    })
    .returning();
  if (!action) throw Error('WRITE_FAILED');
  await tx
    .insert(actionRevision)
    .values({ actionId: action.id, revisionNo: 1, actorId, status: 'active' });
  const legs = [];
  // Write the debit first: a later failure must roll back both this leg and its balance.
  for (const [account, role, amount, balance, description] of [
    [
      source,
      'transfer_out',
      accepted.debit,
      accepted.sourceBalance,
      input.sourceDescription,
    ],
    [
      destination,
      'transfer_in',
      accepted.credit,
      accepted.destinationBalance,
      input.destinationDescription,
    ],
  ] as const) {
    const [leg] = await tx
      .insert(ledgerLeg)
      .values({
        workspaceId: account.workspaceId,
        actionId: action.id,
        revisionNo: 1,
        accountId: account.id,
        role,
        amount,
        currency: account.currency,
        financialDate: input.financialDate,
        privateDescription: description,
      })
      .returning();
    if (!leg) throw Error('WRITE_FAILED');
    legs.push(leg);
    await tx
      .update(financialAccount)
      .set({ balanceProjection: balance, version: account.version + 1n })
      .where(
        and(
          eq(financialAccount.id, account.id),
          eq(financialAccount.workspaceId, account.workspaceId),
        ),
      );
    await tx.insert(scopedAuditEvent).values({
      workspaceId: account.workspaceId,
      objectType: 'transfer',
      objectId: action.id,
      actorId,
      revisionNo: 1,
      kind: 'create',
      beforeScope: null,
      afterScope: { ...projectLeg(leg, account.workspaceId), version: '1' },
    });
  }
  await tx.insert(transferDetail).values({
    actionId: action.id,
    revisionNo: 1,
    sourceLegId: legs[0]!.id,
    destinationLegId: legs[1]!.id,
    rateNumerator: accepted.rateNumerator,
    rateDenominator: accepted.rateDenominator,
    rateDecimal: accepted.rateDecimal,
    rateDirection: 'source_per_destination',
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
export async function projectTransfer(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
): Promise<TransferDto> {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const rows = await tx
    .select({ leg: ledgerLeg, version: financialAction.version })
    .from(ledgerLeg)
    .innerJoin(
      financialAction,
      and(
        eq(financialAction.id, ledgerLeg.actionId),
        eq(financialAction.currentRevision, ledgerLeg.revisionNo),
        eq(financialAction.status, 'active'),
        eq(financialAction.kind, 'transfer'),
      ),
    )
    .where(
      and(eq(ledgerLeg.workspaceId, workspaceId), eq(ledgerLeg.actionId, id)),
    )
    .orderBy(ledgerLeg.role);
  if (!rows.length) throw new AccessError();
  return {
    id,
    workspaceId,
    version: rows[0]!.version.toString(),
    legs: rows.map(({ leg }) => ({
      ...projectLeg(leg, workspaceId),
      amount: validateAmount(leg.amount, leg.currency),
    })),
  };
}
