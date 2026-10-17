import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  bigint,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
export const financialAccount = pgTable(
  'financial_account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    openingBalance: numeric('opening_balance').notNull(),
    balanceProjection: numeric('balance_projection').notNull(),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('account_scope_id').on(t.workspaceId, t.id),
    unique('account_scope_currency').on(t.workspaceId, t.id, t.currency),
    index('account_scope_archive').on(t.workspaceId, t.archivedAt),
    check('account_currency_valid', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'account_money_finite',
      sql`${t.openingBalance} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND ${t.balanceProjection} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check('account_version_positive', sql`${t.version}>0`),
  ],
);
