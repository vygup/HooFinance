import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  bigint,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
import { category } from './categories';
export const monthlyBudget = pgTable(
  'monthly_budget',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    month: date('month', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),
    plannedIncome: numeric('planned_income').notNull(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('budget_scope_id').on(t.workspaceId, t.id),
    unique('budget_scope_month_currency').on(
      t.workspaceId,
      t.month,
      t.currency,
    ),
    check('budget_first_day', sql`extract(day from ${t.month})=1`),
    check(
      'budget_plan_valid',
      sql`${t.plannedIncome}>=0 AND ${t.plannedIncome} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check('budget_version_positive', sql`${t.version}>0`),
  ],
);
export const budgetLimit = pgTable(
  'budget_limit',
  {
    workspaceId: uuid('workspace_id').notNull(),
    budgetId: uuid('budget_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    amount: numeric('amount').notNull(),
  },
  (t) => [
    unique('budget_category_unique').on(t.budgetId, t.categoryId),
    foreignKey({
      columns: [t.workspaceId, t.budgetId],
      foreignColumns: [monthlyBudget.workspaceId, monthlyBudget.id],
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }).onDelete('restrict'),
    check(
      'budget_limit_valid',
      sql`${t.amount}>=0 AND ${t.amount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
  ],
);
