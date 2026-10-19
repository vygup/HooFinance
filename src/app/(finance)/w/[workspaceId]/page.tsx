import { authenticatedRead } from '@/modules/identity/presentation/session';
import { readProfile } from '@/modules/identity/application/registration';
import { readWorkspaceDashboard } from '@/modules/reporting/application/dashboard';
import { DashboardView } from '@/modules/reporting/presentation/dashboard-view';
import { AccessDenied } from '@/modules/workspaces/presentation/access-denied';
import { AccessError } from '@/server/security/access';
import { dashboardInput } from '@/modules/reporting/application/dashboard-input';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const profile = await authenticatedRead(readProfile);
  if (!dashboardInput.safeParse({ workspaceId }).success)
    return <AccessDenied workspaceId={workspaceId} />;
  let report;
  try {
    report = await authenticatedRead((h) =>
      readWorkspaceDashboard(h, { workspaceId }),
    );
  } catch (error) {
    if (error instanceof AccessError)
      return <AccessDenied workspaceId={workspaceId} />;
    throw error;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Финансовый обзор</h1>
      <DashboardView
        key={workspaceId}
        initial={report}
        locale={profile.locale}
      />
    </>
  );
}
