import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  date,
  bigint,
  unique,
  foreignKey,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
import { financialAccount } from './accounts';
import { category } from './categories';
import { financialAction } from './ledger';
export const obligation = pgTable(
  'obligation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    name: text('name').notNull(),
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull(),
    repeatEvery: integer('repeat_every').notNull(),
    repeatUnit: text('repeat_unit').notNull(),
    anchorDate: date('anchor_date', { mode: 'string' }).notNull(),
    anchorDay: integer('anchor_day').notNull(),
    categoryId: uuid('category_id').notNull(),
    accountId: uuid('account_id').notNull(),
    status: text('status').notNull().default('active'),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('obligation_scope_id').on(t.workspaceId, t.id),
    unique('obligation_scope_currency').on(t.workspaceId, t.id, t.currency),
    foreignKey({
      columns: [t.workspaceId, t.accountId, t.currency],
      foreignColumns: [
        financialAccount.workspaceId,
        financialAccount.id,
        financialAccount.currency,
      ],
    }),
    foreignKey({
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }),
    check(
      'obligation_amount',
      sql`${t.amount}>=0 AND ${t.amount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check(
      'obligation_calendar',
      sql`${t.repeatEvery}>0 AND ${t.repeatUnit} IN ('day','week','month','year') AND ${t.anchorDay}=extract(day from ${t.anchorDate})`,
    ),
    check(
      'obligation_status',
      sql`${t.status} IN ('active','paused','archived') AND ${t.version}>0`,
    ),
  ],
);
export const obligationOccurrence = pgTable(
  'obligation_occurrence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    obligationId: uuid('obligation_id').notNull(),
    scheduledDate: date('scheduled_date', { mode: 'string' }).notNull(),
    scheduledAmount: numeric('scheduled_amount').notNull(),
    currency: text('currency').notNull(),
    sourceVersion: integer('source_version').notNull(),
    status: text('status').notNull().default('planned'),
    paymentActionId: uuid('payment_action_id').references(
      () => financialAction.id,
    ),
  },
  (t) => [
    unique('occurrence_scope_id').on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.obligationId, t.currency],
      foreignColumns: [
        obligation.workspaceId,
        obligation.id,
        obligation.currency,
      ],
    }),
    uniqueIndex('occurrence_one_date')
      .on(t.obligationId, t.scheduledDate)
      .where(sql`${t.status}<>'superseded'`),
    uniqueIndex('occurrence_one_payment')
      .on(t.paymentActionId)
      .where(sql`${t.status}='paid'`),
    check(
      'occurrence_status',
      sql`(${t.status}='paid' AND ${t.paymentActionId} IS NOT NULL) OR (${t.status} IN ('planned','superseded') AND ${t.paymentActionId} IS NULL)`,
    ),
    check(
      'occurrence_amount',
      sql`${t.scheduledAmount}>=0 AND ${t.sourceVersion}>0 AND ${t.scheduledAmount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
  ],
);
