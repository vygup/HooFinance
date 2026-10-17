import { getAuth } from '@/server/auth/auth';
import {
  privateHeaders,
  projectAuthPayload,
} from '@/server/security/projection';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(request: Request) {
  let response = await getAuth().handler(request);
  // Better Auth redirects may carry JSON content-type with an empty body.
  if (
    (response.status < 300 || response.status >= 400) &&
    response.status !== 204 &&
    response.headers.get('content-type')?.includes('application/json')
  ) {
    const payload: unknown = await response.json();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('etag');
    response = Response.json(projectAuthPayload(payload), {
      status: response.status,
      headers,
    });
  }
  for (const [key, value] of Object.entries(privateHeaders))
    response.headers.set(key, value);
  return response;
}
export const GET = handler;
export const POST = handler;
