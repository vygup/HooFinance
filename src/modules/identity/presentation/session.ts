import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccessError } from '@/server/security/access';
export async function authenticatedRead<T>(
  read: (headers: Headers) => Promise<T>,
) {
  try {
    return await read(new Headers(await headers()));
  } catch (error) {
    if (error instanceof AccessError && error.code === 'UNAUTHORIZED')
      redirect('/login');
    throw error;
  }
}
