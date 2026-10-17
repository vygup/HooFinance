import 'server-only';
import { cookies, headers } from 'next/headers';
import {
  parseSetCookieHeader,
  toCookieOptions,
} from 'better-auth/cookies/utils';
import { randomUUID } from 'node:crypto';
import { logError } from '@/server/security/logging';
import type { z } from 'zod';
import type { IdentityResult } from './action-result';
export async function identityTransport<T>(
  schema: z.ZodType<T>,
  input: unknown,
  execute: (data: T, headers: Headers) => Promise<Response>,
  message: string,
): Promise<IdentityResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues)
      (fieldErrors[issue.path.join('.') || '_form'] ??= []).push(issue.message);
    return { status: 'validation', fieldErrors };
  }
  try {
    const response = await execute(parsed.data, new Headers(await headers()));
    if (!response.ok)
      return {
        status: 'error',
        message:
          response.status === 429
            ? 'Слишком много попыток. Попробуйте позже.'
            : message,
      };
    const jar = await cookies();
    for (const value of response.headers.getSetCookie())
      for (const [name, cookie] of parseSetCookieHeader(value))
        jar.set(name, cookie.value, toCookieOptions(cookie));
    return { status: 'success' };
  } catch {
    logError('AUTH_ERROR', { correlationId: randomUUID() });
    return {
      status: 'unavailable',
      message: 'Не удалось выполнить действие. Попробуйте ещё раз.',
    };
  }
}
