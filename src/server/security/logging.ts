import 'server-only';
import { randomUUID } from 'node:crypto';
export function correlationId() {
  return randomUUID();
}
export function logError(
  code: 'DATABASE_ERROR' | 'AUTH_ERROR' | 'COMMAND_ERROR' | 'MAIL_ERROR',
  context: { correlationId: string; actorId?: string; workspaceId?: string },
) {
  // Только разрешённые поля; ошибки, URL и payload никогда не сериализуются.
  console.error(
    JSON.stringify({
      code,
      correlationId: context.correlationId,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
    }),
  );
}
