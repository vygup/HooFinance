import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
export const category = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    unique('category_scope_id').on(t.workspaceId, t.id),
    index('category_scope_kind_archive').on(
      t.workspaceId,
      t.kind,
      t.archivedAt,
    ),
    check('category_kind_valid', sql`${t.kind} IN ('income','expense')`),
    check('category_version_positive', sql`${t.version}>0`),
  ],
);
