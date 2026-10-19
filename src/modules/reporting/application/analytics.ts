import 'server-only';
import { eq } from 'drizzle-orm';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { requireWorkspace } from '@/server/security/access';
import { userProfile } from '@/server/db/schema/identity';
import { todayInTimezone } from '@/shared/calendar/calendar';
import { analyticsInput } from './analytics-input';
import { analyticsPeriod, summarizeAnalytics } from '../domain/analytics';
import {
  analyticsRows,
  analyticsViews,
} from '../infrastructure/analytics-repository';
/** Read-only snapshot: no financial command, receipt, version increment or audit mutation. */
export async function readAnalytics(
  headers: Headers,
  workspaceId: string,
  input: unknown,
  instant = new Date(),
) {
  const selection = analyticsInput.parse(input);
  return readWorkspaceSnapshot(
    headers,
    workspaceId,
    async ({ tx, actorId }) => {
      const scope = await requireWorkspace(actorId, workspaceId, 'read', tx);
      const [profile] = await tx
        .select({ timezone: userProfile.timezone })
        .from(userProfile)
        .where(eq(userProfile.userId, actorId));
      const timezone =
        scope.kind === 'family' ? scope.timezone! : profile!.timezone;
      const period = analyticsPeriod(
        selection,
        todayInTimezone(timezone, instant),
      );
      const rows = await analyticsRows(
        tx,
        workspaceId,
        period.from,
        period.until,
      );
      return {
        workspaceId,
        timezone,
        ...period,
        ...summarizeAnalytics(rows),
        ...(await analyticsViews(
          tx,
          workspaceId,
          actorId,
          period.from,
          period.until,
          rows,
        )),
      };
    },
  );
}
export type AnalyticsReport = Awaited<ReturnType<typeof readAnalytics>>;
