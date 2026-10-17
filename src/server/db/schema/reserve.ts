import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  bigint,
  unique,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
import { financialAccount } from './accounts';
export const goal = pgTable(
  'goal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    accountId: uuid('account_id').notNull(),
    ordinaryTarget: numeric('ordinary_target'),
    targetDate: date('target_date', { mode: 'string' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('goal_scope_id').on(t.workspaceId, t.id),
    uniqueIndex('goal_one_active_account')
      .on(t.workspaceId, t.accountId)
      .where(sql`${t.archivedAt} IS NULL`),
    foreignKey({
      columns: [t.workspaceId, t.accountId, t.currency],
      foreignColumns: [
        financialAccount.workspaceId,
        financialAccount.id,
        financialAccount.currency,
      ],
    }).onDelete('restrict'),
    check(
      'goal_type_target',
      sql`(${t.type}='ordinary' AND ${t.ordinaryTarget} IS NOT NULL AND ${t.ordinaryTarget}>0 AND ${t.ordinaryTarget} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) OR (${t.type}='reserve' AND ${t.ordinaryTarget} IS NULL)`,
    ),
    check('goal_version_positive', sql`${t.version}>0`),
  ],
);
export const reserveSettings = pgTable(
  'reserve_settings',
  {
    workspaceId: uuid('workspace_id').notNull(),
    goalId: uuid('goal_id').notNull(),
    monthlyAmount: numeric('monthly_amount').notNull(),
    coverageMonths: numeric('coverage_months').notNull(),
    linkedObligationId: uuid('linked_obligation_id'),
  },
  (t) => [
    unique('reserve_one_goal').on(t.workspaceId, t.goalId),
    foreignKey({
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goal.workspaceId, goal.id],
    }).onDelete('restrict'),
    check(
      'reserve_amount_valid',
      sql`${t.monthlyAmount}>=0 AND ${t.monthlyAmount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check(
      'reserve_months_valid',
      sql`${t.coverageMonths}>0 AND ${t.coverageMonths}=trunc(${t.coverageMonths}) AND ${t.coverageMonths} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check('reserve_link_unavailable', sql`${t.linkedObligationId} IS NULL`),
  ],
);
