import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { monthlyBudget, budgetLimit } from '@/server/db/schema/monthly-budget';
import { category } from '@/server/db/schema/categories';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
import { AccessError, requireWorkspace } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import { validateAmount } from '@/shared/money/decimal';
import type { BudgetInput, BudgetPlan } from '../domain/monthly-budget';
export async function findBudget(
  tx: Transaction,
  workspaceId: string,
  month: string,
  currency: string,
): Promise<BudgetPlan | null> {
  const [row] = await tx
    .select()
    .from(monthlyBudget)
    .where(
      and(
        eq(monthlyBudget.workspaceId, workspaceId),
        eq(monthlyBudget.month, `${month}-01`),
        eq(monthlyBudget.currency, currency),
      ),
    );
  if (!row) return null;
  const limits = await tx
    .select({ categoryId: budgetLimit.categoryId, amount: budgetLimit.amount })
    .from(budgetLimit)
    .where(
      and(
        eq(budgetLimit.workspaceId, workspaceId),
        eq(budgetLimit.budgetId, row.id),
      ),
    )
    .orderBy(budgetLimit.categoryId);
  return {
    id: row.id,
    workspaceId,
    month,
    currency,
    plannedIncome: validateAmount(row.plannedIncome, currency),
    version: row.version.toString(),
    categoryLimits: limits.map((l) => ({
      ...l,
      amount: validateAmount(l.amount, currency),
    })),
  };
}
export async function projectBudget(
  tx: Transaction,
  ref: { month: string; currency: string },
  workspaceId: string,
  actorId: string,
) {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const result = await findBudget(tx, workspaceId, ref.month, ref.currency);
  if (!result) throw new AccessError();
  return result;
}
export async function persistBudget(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: BudgetInput,
  expectedVersion?: string,
) {
  const before = await findBudget(tx, workspaceId, input.month, input.currency);
  if (
    before ? before.version !== expectedVersion : expectedVersion !== undefined
  )
    throw new CommandConflict();
  const categories = await tx
    .select()
    .from(category)
    .where(eq(category.workspaceId, workspaceId));
  for (const limit of input.categoryLimits) {
    const c = categories.find((c) => c.id === limit.categoryId);
    if (
      !c ||
      c.kind !== 'expense' ||
      (c.archivedAt &&
        !before?.categoryLimits.some((l) => l.categoryId === c.id))
    )
      throw new AccessError();
  }
  let id: string;
  if (before) {
    id = before.id;
    await tx
      .update(monthlyBudget)
      .set({
        plannedIncome: input.plannedIncome,
        version: BigInt(before.version) + 1n,
      })
      .where(
        and(
          eq(monthlyBudget.id, id),
          eq(monthlyBudget.workspaceId, workspaceId),
        ),
      );
    await tx
      .delete(budgetLimit)
      .where(
        and(
          eq(budgetLimit.workspaceId, workspaceId),
          eq(budgetLimit.budgetId, id),
        ),
      );
  } else {
    const [row] = await tx
      .insert(monthlyBudget)
      .values({
        workspaceId,
        month: `${input.month}-01`,
        currency: input.currency,
        plannedIncome: input.plannedIncome,
      })
      .returning();
    id = row!.id;
  }
  if (input.categoryLimits.length)
    await tx
      .insert(budgetLimit)
      .values(
        input.categoryLimits.map((l) => ({ ...l, workspaceId, budgetId: id })),
      );
  const after = await findBudget(tx, workspaceId, input.month, input.currency);
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: 'monthly_budget',
    objectId: id,
    actorId,
    kind: before ? 'update' : 'create',
    revisionNo: Number(after!.version),
    beforeScope: before,
    afterScope: after,
  });
  return { month: input.month, currency: input.currency };
}
