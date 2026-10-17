import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspaces';
import { user } from './identity';
export const ownershipOffer = pgTable(
  'ownership_offer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    initiatorId: text('initiator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('pending'),
    workspaceVersion: bigint('workspace_version', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'ownership_offer_status',
      sql`${t.status} IN ('pending','accepted','cancelled')`,
    ),
    check('ownership_offer_version', sql`${t.workspaceVersion}>0`),
    check('ownership_offer_distinct', sql`${t.initiatorId}<>${t.recipientId}`),
    index('ownership_offer_scope').on(t.workspaceId, t.status),
  ],
);
