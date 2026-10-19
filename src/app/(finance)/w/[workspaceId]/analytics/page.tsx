import Link from 'next/link';
import { authenticatedRead } from '@/modules/identity/presentation/session';
import { readProfile } from '@/modules/identity/application/registration';
import { readAnalytics } from '@/modules/reporting/application/analytics';
import { AnalyticsView } from '@/modules/reporting/presentation/analytics-view';
import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { AccessError } from '@/server/security/access';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const profile = await authenticatedRead(readProfile);
  let report;
  try {
    report = await authenticatedRead((h) =>
      readAnalytics(h, workspaceId, { period: 'current' }),
    );
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Аналитика по периодам</h1>
      <Link className="underline" href={`/w/${workspaceId}/accounts`}>
        Счета
      </Link>
      <AnalyticsView
        key={workspaceId}
        workspaceId={workspaceId}
        initial={report}
        locale={profile.locale}
      />
    </>
  );
}
