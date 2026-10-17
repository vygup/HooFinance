import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  numeric,
  date,
  jsonb,
  primaryKey,
  unique,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { user } from './identity';
import { workspace } from './workspaces';
import { financialAccount } from './accounts';
import { category } from './categories';
export const financialAction = pgTable(
  'financial_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    currentRevision: integer('current_revision').notNull(),
    status: text('status').notNull(),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('action_kind', sql`${t.kind} IN ('income','expense','transfer')`),
    check('action_status', sql`${t.status} IN ('active','deleted')`),
    check('action_version', sql`${t.version}>0 AND ${t.currentRevision}>0`),
  ],
);
export const actionRevision = pgTable(
  'action_revision',
  {
    actionId: uuid('action_id')
      .notNull()
      .references(() => financialAction.id, { onDelete: 'restrict' }),
    revisionNo: integer('revision_no').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    happenedAt: timestamp('happened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text('reason'),
    status: text('status').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.revisionNo] }),
    check('revision_positive', sql`${t.revisionNo}>0`),
    check('revision_status', sql`${t.status} IN ('active','deleted')`),
  ],
);
export const ledgerLeg = pgTable(
  'ledger_leg',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    actionId: uuid('action_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    accountId: uuid('account_id').notNull(),
    role: text('role').notNull(),
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull(),
    financialDate: date('financial_date', { mode: 'string' }).notNull(),
    categoryId: uuid('category_id'),
    privateDescription: text('private_description'),
  },
  (t) => [
    unique('leg_action_revision_role').on(t.actionId, t.revisionNo, t.role),
    foreignKey({
      name: 'leg_revision_fk',
      columns: [t.actionId, t.revisionNo],
      foreignColumns: [actionRevision.actionId, actionRevision.revisionNo],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leg_scope_account_fk',
      columns: [t.workspaceId, t.accountId, t.currency],
      foreignColumns: [
        financialAccount.workspaceId,
        financialAccount.id,
        financialAccount.currency,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leg_scope_category_fk',
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }).onDelete('restrict'),
    check(
      'leg_money',
      sql`${t.amount}>0 AND ${t.amount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check(
      'leg_role_category',
      sql`(${t.role} IN ('income','expense') AND ${t.categoryId} IS NOT NULL) OR (${t.role} IN ('transfer_out','transfer_in') AND ${t.categoryId} IS NULL)`,
    ),
    index('leg_scope_date').on(t.workspaceId, t.financialDate, t.id),
    index('leg_scope_account_date').on(
      t.workspaceId,
      t.accountId,
      t.financialDate,
    ),
    index('leg_scope_category_date').on(
      t.workspaceId,
      t.categoryId,
      t.financialDate,
    ),
  ],
);
export const transferDetail = pgTable(
  'transfer_detail',
  {
    actionId: uuid('action_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    sourceLegId: uuid('source_leg_id')
      .notNull()
      .references(() => ledgerLeg.id, { onDelete: 'restrict' }),
    destinationLegId: uuid('destination_leg_id')
      .notNull()
      .references(() => ledgerLeg.id, { onDelete: 'restrict' }),
    rateNumerator: numeric('rate_numerator').notNull(),
    rateDenominator: numeric('rate_denominator').notNull(),
    rateDecimal: numeric('rate_decimal').notNull(),
    rateDirection: text('rate_direction').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.revisionNo] }),
    foreignKey({
      columns: [t.actionId, t.revisionNo],
      foreignColumns: [actionRevision.actionId, actionRevision.revisionNo],
    }).onDelete('restrict'),
    check(
      'transfer_positive_finite',
      sql`${t.rateNumerator}>0 AND ${t.rateDenominator}>0 AND ${t.rateDecimal}>0 AND ${t.rateNumerator} NOT IN ('NaN'::numeric,'Infinity'::numeric) AND ${t.rateDenominator} NOT IN ('NaN'::numeric,'Infinity'::numeric) AND ${t.rateDecimal} NOT IN ('NaN'::numeric,'Infinity'::numeric)`,
    ),
    check(
      'transfer_distinct_legs',
      sql`${t.sourceLegId} <> ${t.destinationLegId}`,
    ),
  ],
);
export const scopedAuditEvent = pgTable(
  'scoped_audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revisionNo: integer('revision_no').notNull(),
    beforeScope: jsonb('before_scope'),
    afterScope: jsonb('after_scope'),
    kind: text('kind').notNull(),
  },
  (t) => [index('audit_scope_date').on(t.workspaceId, t.occurredAt, t.id)],
);
export const commandReceipt = pgTable(
  'command_receipt',
  {
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    operationKey: uuid('operation_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    actionId: uuid('action_id').references(() => financialAction.id, {
      onDelete: 'restrict',
    }),
    resultRef: jsonb('result_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.operationKey] }),
    check('receipt_status', sql`${t.status} IN ('pending','completed')`),
  ],
);
