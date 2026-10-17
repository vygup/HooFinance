import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { user, organization } from './identity';
export const workspace = pgTable(
  'workspace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    personalOwnerId: text('personal_owner_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'restrict',
    }),
    familyOwnerId: text('family_owner_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    timezone: text('timezone'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by').references(() => user.id, {
      onDelete: 'restrict',
    }),
    version: bigint('version', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (t) => [
    uniqueIndex('workspace_personal_owner')
      .on(t.personalOwnerId)
      .where(sql`${t.kind} = 'personal'`),
    uniqueIndex('workspace_organization').on(t.organizationId),
    check(
      'workspace_kind_valid',
      sql`(${t.kind} = 'personal' AND ${t.personalOwnerId} IS NOT NULL AND ${t.organizationId} IS NULL AND ${t.familyOwnerId} IS NULL AND ${t.deletedAt} IS NULL AND ${t.deletedBy} IS NULL) OR (${t.kind} = 'family' AND ${t.personalOwnerId} IS NULL AND ${t.organizationId} IS NOT NULL AND ${t.familyOwnerId} IS NOT NULL AND ${t.timezone} IS NOT NULL)`,
    ),
    check(
      'workspace_deleted_pair',
      sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`,
    ),
    check('workspace_version_positive', sql`${t.version} > 0`),
  ],
);
