import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { workspace } from '@/server/db/schema/workspaces';
import {
  obligation,
  obligationOccurrence,
} from '@/server/db/schema/recurring-payments';
import { financialAccount } from '@/server/db/schema/accounts';
import { category } from '@/server/db/schema/categories';
import {
  currentActor,
  requireWorkspace,
  AccessError,
} from '@/server/security/access';
import {
  financialTransaction,
  CommandConflict,
  CommandValidation,
} from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import { acceptExpense } from '@/modules/categories/domain/expenses';
import {
  incomeCategory,
  saveIncome,
} from '@/modules/ledger/infrastructure/income-repository';
import { projectGoal } from '@/modules/goals/infrastructure/reserve-repository';
import {
  recurringPaymentInput,
  confirmPaymentInput,
  paymentDate,
} from './recurring-payments-input';
import {
  persistObligation,
  projectObligation,
  projectPayment,
  linkReserve,
  workspaceToday,
  obligationDto,
  paymentRows,
} from '../infrastructure/recurring-payments-repository';
import { materializePayments } from '../infrastructure/schedule-history-repository';
import { paymentTotals } from '../domain/overdue';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
export async function obligationCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = recurringPaymentInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  const payload = p.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: recurringPaymentInput,
    workspaceIds: [e.data.workspaceId],
    accountIds:
      payload.command === 'create' || payload.command === 'update'
        ? [payload.accountId]
        : [],
    execute: async ({ tx, actorId }) => ({
      reference:
        payload.command === 'linkReserve'
          ? {
              kind: 'reserve' as const,
              id: await linkReserve(
                tx,
                actorId,
                e.data.workspaceId,
                payload,
                e.data.expectedVersion,
              ),
            }
          : {
              kind: 'obligation' as const,
              id: await persistObligation(
                tx,
                actorId,
                e.data.workspaceId,
                payload,
                e.data.expectedVersion,
              ),
            },
    }),
    project: async (tx, ref, actorId) =>
      ref.kind === 'reserve'
        ? projectGoal(tx, ref.id, e.data.workspaceId, actorId)
        : projectObligation(tx, ref.id, e.data.workspaceId, actorId),
  });
}
export async function confirmPayment(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = confirmPaymentInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  const payload = p.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: confirmPaymentInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [payload.accountId],
    execute: async ({ tx, actorId, accounts, confirmed }) => {
      const [occ] = await tx
        .select()
        .from(obligationOccurrence)
        .where(
          and(
            eq(obligationOccurrence.id, payload.occurrenceId),
            eq(obligationOccurrence.workspaceId, e.data.workspaceId),
          ),
        )
        .for('update');
      if (!occ || occ.status === 'superseded') throw new AccessError();
      if (occ.status === 'paid') {
        const paid = await projectPayment(
          tx,
          occ.id,
          e.data.workspaceId,
          actorId,
        );
        if (
          paid.actualDate !== payload.actualDate ||
          paid.actualAccountId !== payload.accountId ||
          paid.actualAmount !==
            validatePaymentAmount(payload.actualAmount, occ.currency)
        )
          throw new CommandConflict();
        return { reference: occ.id };
      }
      const [o] = await tx
        .select()
        .from(obligation)
        .where(
          and(
            eq(obligation.id, occ.obligationId),
            eq(obligation.workspaceId, e.data.workspaceId),
          ),
        )
        .for('update');
      const account = accounts[0];
      if (!o || !account || account.currency !== occ.currency)
        throw new AccessError();
      let accepted;
      try {
        accepted = acceptExpense(
          account.balanceProjection,
          payload.actualAmount,
          account.currency,
        );
      } catch {
        throw new CommandValidation({
          actualAmount: ['Проверьте положительную сумму и её точность'],
        });
      }
      const categoryId = await incomeCategory(
        tx,
        e.data.workspaceId,
        { id: o.categoryId },
        actorId,
        'expense',
      );
      if (accepted.warning && !confirmed)
        return {
          confirmationBalances: [
            {
              accountId: account.id,
              amount: accepted.balance,
              currency: account.currency,
            },
          ],
        };
      const actionId = await saveIncome(
        tx,
        actorId,
        e.data.workspaceId,
        e.data.operationKey,
        account,
        {
          accountId: account.id,
          amount: payload.actualAmount,
          financialDate: payload.actualDate,
          category: { id: categoryId },
          description: o.name,
        },
        categoryId,
        accepted,
        'expense',
      );
      await tx
        .update(obligationOccurrence)
        .set({ status: 'paid', paymentActionId: actionId })
        .where(eq(obligationOccurrence.id, occ.id));
      await tx.insert(scopedAuditEvent).values({
        workspaceId: e.data.workspaceId,
        objectType: 'obligation',
        objectId: o.id,
        actorId,
        revisionNo: Number(o.version),
        kind: 'payment',
        beforeScope: { occurrenceId: occ.id, status: 'planned' },
        afterScope: {
          occurrenceId: occ.id,
          status: 'paid',
          paymentActionId: actionId,
        },
      });
      return { reference: occ.id };
    },
    project: (tx, id, actorId) =>
      projectPayment(tx, id, e.data.workspaceId, actorId),
  });
}
import { validateAmount } from '@/shared/money/decimal';
function validatePaymentAmount(amount: string, currency: string) {
  try {
    return validateAmount(amount, currency);
  } catch {
    throw new CommandValidation({ actualAmount: ['Проверьте точность суммы'] });
  }
}
export async function readObligations(
  headers: Headers,
  workspaceId: string,
  from: string,
  until: string,
  instant = new Date(),
) {
  paymentDate.parse(from);
  paymentDate.parse(until);
  if (from > until)
    throw new CommandValidation({ until: ['Конец интервала раньше начала'] });
  const actorId = await currentActor(headers);
  return getDb().transaction(async (tx) => {
    await requireWorkspace(actorId, workspaceId, 'read', tx);
    await tx
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .for('update');
    await requireWorkspace(actorId, workspaceId, 'read', tx);
    const today = await workspaceToday(tx, workspaceId, instant);
    const obligations = await tx
      .select()
      .from(obligation)
      .where(eq(obligation.workspaceId, workspaceId))
      .orderBy(obligation.name, obligation.id)
      .for('update');
    for (const o of obligations)
      await materializePayments(tx, workspaceId, o.id, from, until, today);
    const payments = [];
    for (const row of await paymentRows(tx, workspaceId)) {
      if (
        row.scheduledDate > today &&
        (row.scheduledDate < from || row.scheduledDate > until)
      )
        continue;
      payments.push({
        ...(await projectPayment(tx, row.id, workspaceId, actorId)),
        name: obligations.find((o) => o.id === row.obligationId)!.name,
        accountId: obligations.find((o) => o.id === row.obligationId)!
          .accountId,
        overdue: row.status === 'planned' && row.scheduledDate < today,
      });
    }
    const accounts = await tx
      .select()
      .from(financialAccount)
      .where(eq(financialAccount.workspaceId, workspaceId));
    const categories = await tx
      .select()
      .from(category)
      .where(eq(category.workspaceId, workspaceId));
    return {
      today,
      from,
      until,
      obligations: obligations.map(obligationDto),
      payments,
      totals: paymentTotals(payments.filter((p) => p.status === 'planned')),
      accounts: accounts
        .filter((a) => !a.archivedAt)
        .map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
      categories: categories
        .filter((c) => !c.archivedAt && c.kind === 'expense')
        .map((c) => ({ id: c.id, name: c.name })),
    };
  });
}
