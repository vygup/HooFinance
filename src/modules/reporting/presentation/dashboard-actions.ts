'use server';
import { headers } from 'next/headers';
import { dashboardInput } from '../application/dashboard-input';
import { readWorkspaceDashboard } from '../application/dashboard';
import { AccessError } from '@/server/security/access';
export async function dashboardAction(input: unknown) {
  const parsed = dashboardInput.safeParse(input);
  if (!parsed.success) return { status: 'validation_error' as const };
  try {
    return {
      status: 'success' as const,
      data: await readWorkspaceDashboard(
        new Headers(await headers()),
        parsed.data,
      ),
    };
  } catch (error) {
    if (error instanceof AccessError) return { status: 'forbidden' as const };
    return { status: 'unavailable' as const };
  }
}
