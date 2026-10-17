import { exportHistory } from '@/modules/data-exchange/application/export-history';
import { AccessError } from '@/server/security/access';
import { privateHeaders, privateJson } from '@/server/security/projection';
import { correlationId, logError } from '@/server/security/logging';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    return new Response(await exportHistory(request.headers, workspaceId), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="family-history.csv"',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AccessError)
      return privateJson(
        {
          status: error.code === 'UNAUTHORIZED' ? 'unauthorized' : 'forbidden',
        },
        error.code === 'UNAUTHORIZED' ? 401 : 403,
      );
    logError('COMMAND_ERROR', { correlationId: correlationId() });
    return privateJson({ status: 'unavailable' }, 503);
  }
}
