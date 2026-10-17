import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
export const authRateBucket = pgTable(
  'auth_rate_bucket',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    subjectHash: text('subject_hash').notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
    }).notNull(),
    attemptTimestamps: jsonb('attempt_timestamps')
      .$type<{ id: string; at: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_bucket_expiry').on(t.expiresAt)],
);
