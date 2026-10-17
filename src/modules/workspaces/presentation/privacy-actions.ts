'use server';
import { headers } from 'next/headers';
import { readPrivacy } from '../application/privacy';
import { AccessError } from '@/server/security/access';
export async function checkPrivacyAction(input: unknown) {
  try {
    await readPrivacy(new Headers(await headers()), input);
    return { status: 'success' as const };
  } catch (error) {
    if (error instanceof AccessError)
      return {
        status:
          error.code === 'UNAUTHORIZED'
            ? ('unauthorized' as const)
            : ('forbidden' as const),
      };
    return { status: 'unavailable' as const };
  }
}
