'use server';
import { z } from 'zod';
import { getAuth } from '@/server/auth/auth';
import { identityTransport } from './action-transport';
export async function logoutAction() {
  return identityTransport(
    z.strictObject({}),
    {},
    (_, headers) => getAuth().api.signOut({ headers, asResponse: true }),
    'Не удалось выйти. Попробуйте ещё раз.',
  );
}
