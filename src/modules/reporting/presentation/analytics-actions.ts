'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { analyticsInput } from '../application/analytics-input';
import { readAnalytics } from '../application/analytics';
import { AccessError } from '@/server/security/access';
export async function analyticsAction(workspaceId: unknown, input: unknown) {
  const scope = z.uuid().safeParse(workspaceId),
    selection = analyticsInput.safeParse(input);
  if (!scope.success || !selection.success)
    return { status: 'validation_error' as const };
  try {
    return {
      status: 'success' as const,
      data: await readAnalytics(
        new Headers(await headers()),
        scope.data,
        selection.data,
      ),
    };
  } catch (error) {
    if (error instanceof AccessError) return { status: 'forbidden' as const };
    return { status: 'unavailable' as const };
  }
}
