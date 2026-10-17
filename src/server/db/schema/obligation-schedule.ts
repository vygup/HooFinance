import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  date,
  text,
  numeric,
  timestamp,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { obligation } from './recurring-payments';
export const obligationScheduleRevision = pgTable(
  'obligation_schedule_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    obligationId: uuid('obligation_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    anchorDate: date('anchor_date', { mode: 'string' }).notNull(),
    anchorDay: integer('anchor_day').notNull(),
    repeatEvery: integer('repeat_every').notNull(),
    repeatUnit: text('repeat_unit').notNull(),
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull(),
    activeFrom: date('active_from', { mode: 'string' }).notNull(),
    activeUntil: date('active_until', { mode: 'string' }),
    status: text('status').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('obligation_revision_no').on(t.obligationId, t.revisionNo),
    foreignKey({
      columns: [t.workspaceId, t.obligationId, t.currency],
      foreignColumns: [
        obligation.workspaceId,
        obligation.id,
        obligation.currency,
      ],
    }),
    check(
      'obligation_revision_calendar',
      sql`${t.repeatEvery}>0 AND ${t.repeatUnit} IN ('day','week','month','year') AND ${t.anchorDay}=extract(day from ${t.anchorDate}) AND ${t.revisionNo}>0 AND (${t.activeUntil} IS NULL OR ${t.activeUntil}>=${t.activeFrom})`,
    ),
    check(
      'obligation_revision_amount',
      sql`${t.amount}>=0 AND ${t.amount} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`,
    ),
    check(
      'obligation_revision_status',
      sql`${t.status} IN ('active','paused','archived')`,
    ),
  ],
);
