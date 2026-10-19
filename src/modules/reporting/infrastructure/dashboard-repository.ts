import 'server-only';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { financialAccount } from '@/server/db/schema/accounts';
import { financialAction, ledgerLeg } from '@/server/db/schema/ledger';
import { monthlyBudget } from '@/server/db/schema/monthly-budget';
import { goal } from '@/server/db/schema/reserve';
import {
  obligation,
  obligationOccurrence,
} from '@/server/db/schema/recurring-payments';
import { validateAmount } from '@/shared/money/decimal';
import { findBudget } from '@/modules/budgeting/infrastructure/monthly-budget-repository';
import { calculateBudget } from '@/modules/budgeting/domain/monthly-budget';
import { projectGoal } from '@/modules/goals/infrastructure/reserve-repository';
import type { GoalDto } from '@/modules/goals/domain/reserve';
import { scheduleHistory } from '@/modules/obligations/infrastructure/schedule-history-repository';
import { projectPayment } from '@/modules/obligations/infrastructure/recurring-payments-repository';
import {
  paymentTotals,
  schedulePayments,
} from '@/modules/obligations/domain/overdue';
import { analyticsRows } from './analytics-repository';
import { summarizeDashboard } from '../domain/dashboard';

/** Only whitelisted, scoped data; no account histories, audit or opposite transfer legs. */
export async function dashboardSnapshot(
  tx: Transaction,
  workspaceId: string,
  actorId: string,
  monthFrom: string,
  monthUntil: string,
) {
  const rows = await tx
    .select({
      id: financialAccount.id,
      name: financialAccount.name,
      currency: financialAccount.currency,
      balance: financialAccount.balanceProjection,
      archivedAt: financialAccount.archivedAt,
    })
    .from(financialAccount)
    .where(eq(financialAccount.workspaceId, workspaceId))
    .orderBy(financialAccount.name, financialAccount.id);
  const accounts = rows.map(({ archivedAt, ...a }) => ({
    ...a,
    balance: validateAmount(a.balance, a.currency),
    archived: !!archivedAt,
  }));
  const entries = await analyticsRows(tx, workspaceId, monthFrom, monthUntil);
  const plans = await tx
    .select({ currency: monthlyBudget.currency })
    .from(monthlyBudget)
    .where(
      and(
        eq(monthlyBudget.workspaceId, workspaceId),
        eq(monthlyBudget.month, monthFrom),
      ),
    )
    .orderBy(monthlyBudget.currency);
  const budgets = [];
  for (const { currency } of plans) {
    const plan = await findBudget(
      tx,
      workspaceId,
      monthFrom.slice(0, 7),
      currency,
    );
    if (!plan) continue;
    budgets.push({
      month: plan.month,
      currency,
      plannedIncome: plan.plannedIncome,
      ...calculateBudget(
        currency,
        plan.plannedIncome,
        plan.categoryLimits,
        entries.filter((r) => r.role === 'expense'),
      ),
    });
  }
  const targets = await tx
    .select({ id: goal.id })
    .from(goal)
    .where(and(eq(goal.workspaceId, workspaceId), isNull(goal.archivedAt)))
    .orderBy(goal.name, goal.id);
  const goals: GoalDto[] = [],
    reserves: GoalDto[] = [];
  for (const target of targets) {
    const projected = await projectGoal(tx, target.id, workspaceId, actorId);
    (projected.type === 'reserve' ? reserves : goals).push(projected);
  }
  return {
    accounts,
    ...summarizeDashboard(
      accounts,
      entries,
      plans.map((p) => p.currency),
    ),
    budgets,
    goals,
    reserves,
    latestActions: await latestActions(tx, workspaceId),
  };
}
async function latestActions(tx: Transaction, workspaceId: string) {
  const active = and(
    eq(financialAction.id, ledgerLeg.actionId),
    eq(financialAction.currentRevision, ledgerLeg.revisionNo),
    eq(financialAction.status, 'active'),
  );
  // DISTINCT before LIMIT makes a transfer with two local legs one action.
  const actions = await tx
    .selectDistinct({
      id: financialAction.id,
      kind: financialAction.kind,
      date: ledgerLeg.financialDate,
      createdAt: financialAction.createdAt,
    })
    .from(ledgerLeg)
    .innerJoin(financialAction, active)
    .where(eq(ledgerLeg.workspaceId, workspaceId))
    .orderBy(
      desc(ledgerLeg.financialDate),
      desc(financialAction.createdAt),
      financialAction.id,
    )
    .limit(5);
  if (!actions.length) return [];
  const legs = await tx
    .select({
      actionId: ledgerLeg.actionId,
      accountId: ledgerLeg.accountId,
      accountName: financialAccount.name,
      role: ledgerLeg.role,
      amount: ledgerLeg.amount,
      currency: ledgerLeg.currency,
      description: ledgerLeg.privateDescription,
    })
    .from(ledgerLeg)
    .innerJoin(financialAction, active)
    .innerJoin(
      financialAccount,
      and(
        eq(financialAccount.id, ledgerLeg.accountId),
        eq(financialAccount.workspaceId, ledgerLeg.workspaceId),
      ),
    )
    .where(
      and(
        eq(ledgerLeg.workspaceId, workspaceId),
        inArray(
          ledgerLeg.actionId,
          actions.map((a) => a.id),
        ),
      ),
    )
    .orderBy(ledgerLeg.role, ledgerLeg.id);
  return actions.map((a) => ({
    id: a.id,
    kind: a.kind,
    date: a.date,
    legs: legs
      .filter((l) => l.actionId === a.id)
      .map((l) => ({
        accountId: l.accountId,
        accountName: l.accountName,
        role: l.role,
        currency: l.currency,
        amount: validateAmount(l.amount, l.currency),
        description: l.description ?? '',
      })),
  }));
}
/** Compute lazy schedule history without materializing occurrences in a read-only snapshot. */
export async function dashboardPayments(
  tx: Transaction,
  workspaceId: string,
  actorId: string,
  from: string,
  until: string,
  today: string,
) {
  const obligations = await tx
    .select({ id: obligation.id, name: obligation.name })
    .from(obligation)
    .where(eq(obligation.workspaceId, workspaceId))
    .orderBy(obligation.id);
  const payments = [],
    paid = [];
  for (const o of obligations) {
    const { history, saved } = await scheduleHistory(tx, workspaceId, o.id);
    for (const p of schedulePayments(history, saved, from, until, today))
      payments.push({
        id: `${o.id}:${p.scheduledDate}`,
        name: o.name,
        scheduledDate: p.scheduledDate,
        scheduledAmount: p.scheduledAmount,
        currency: p.currency,
        overdue: p.overdue,
      });
    // Paid snapshots keep their original planned amount and the current actual payment.
    const savedRows = await tx
      .select({ id: obligationOccurrence.id })
      .from(obligationOccurrence)
      .where(
        and(
          eq(obligationOccurrence.workspaceId, workspaceId),
          eq(obligationOccurrence.obligationId, o.id),
          eq(obligationOccurrence.status, 'paid'),
        ),
      );
    for (const row of savedRows) {
      const p = await projectPayment(tx, row.id, workspaceId, actorId);
      if (p.scheduledDate >= from && p.scheduledDate <= until) paid.push(p);
    }
  }
  payments.sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.id.localeCompare(b.id),
  );
  const selected = payments.filter(
    (p) => p.scheduledDate >= from && p.scheduledDate <= until,
  );
  return {
    workspaceId,
    from,
    until,
    today,
    payments,
    plan: paymentTotals([...selected, ...paid]),
    fact: paymentTotals(
      paid
        .filter((p) => p.actualAmount !== null)
        .map((p) => ({
          currency: p.currency,
          scheduledAmount: p.actualAmount!,
        })),
    ),
    unpaid: paymentTotals(payments),
    overdue: paymentTotals(payments.filter((p) => p.overdue)),
  };
}
