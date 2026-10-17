import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
export const organizationContext = new AsyncLocalStorage<{
  actorId: string;
  workspaceId: string | null;
  organizationId: string | null;
  paths: readonly string[];
}>();
