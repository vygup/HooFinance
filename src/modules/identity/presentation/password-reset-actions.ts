'use server';
import { getAuth } from '@/server/auth/auth';
import { resetInput } from '../application/registration-input';
import { identityTransport } from './action-transport';
export async function resetPasswordAction(input: unknown) {
  return identityTransport(
    resetInput,
    input,
    (body, headers) =>
      getAuth().api.resetPassword({ body, headers, asResponse: true }),
    'Ссылка недействительна или срок её действия истёк. Запросите новую ссылку.',
  );
}
