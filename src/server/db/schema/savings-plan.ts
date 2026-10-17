import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  date,
  integer,
  numeric,
  bigint,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { goal } from './reserve';
export const savingsPlan = pgTable(
  'savings_plan',
  {
    workspaceId: uuid('workspace_id').notNull(),
    goalId: uuid('goal_id').notNull(),
    anchorDate: date('anchor_date', { mode: 'string' }).notNull(),
    anchorDay: integer('anchor_day').notNull(),
    monthlyContribution: numeric('monthly_contribution'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('savings_plan_one_goal').on(t.workspaceId, t.goalId),
    foreignKey({
      name: 'savings_plan_scope_fk',
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goal.workspaceId, goal.id],
    }).onDelete('restrict'),
    check(
      'savings_plan_anchor_day',
      sql`${t.anchorDay}=extract(day from ${t.anchorDate}) AND ${t.anchorDay} BETWEEN 1 AND 31`,
    ),
    check(
      'savings_plan_amount',
      sql`${t.monthlyContribution} IS NULL OR (${t.monthlyContribution}>=0 AND ${t.monthlyContribution} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))`,
    ),
    check('savings_plan_version', sql`${t.version}>0`),
  ],
);
