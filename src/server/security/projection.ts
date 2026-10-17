import 'server-only';
import { belongsToScope } from '@/modules/workspaces/domain/privacy';
export const privateHeaders = { 'Cache-Control': 'private, no-store' } as const;
export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
export type ScopedLeg = {
  id: string;
  workspaceId: string;
  accountId: string;
  amount: string;
  currency: string;
  financialDate: string;
  role: string;
  privateDescription: string | null;
};
export function projectLeg(leg: ScopedLeg, workspaceId: string) {
  if (!belongsToScope(leg.workspaceId, workspaceId))
    throw new Error('FORBIDDEN');
  return {
    id: leg.id,
    accountId: leg.accountId,
    amount: leg.amount,
    currency: leg.currency,
    financialDate: leg.financialDate,
    role: leg.role,
    description: leg.privateDescription,
  };
}

/** Browser использует HttpOnly cookie; session secrets остаются в серверном Better Auth API. */
export function projectAuthPayload(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value;
  const result = { ...value } as Record<string, unknown>;
  for (const key of [
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'password',
  ])
    delete result[key];
  if (
    typeof result.session === 'object' &&
    result.session !== null &&
    !Array.isArray(result.session)
  ) {
    const session = { ...result.session } as Record<string, unknown>;
    for (const key of ['token', 'ipAddress', 'userAgent']) delete session[key];
    result.session = session;
  }
  return result;
}
