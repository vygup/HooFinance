'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { updateProfile } from '../application/registration';
import { logError } from '@/server/security/logging';
import type { IdentityResult } from './action-result';
export async function profileAction(input: unknown): Promise<IdentityResult> {
  try {
    const result = await updateProfile(new Headers(await headers()), input);
    if (result.status === 'success') {
      revalidatePath('/profile');
      revalidatePath('/dashboard');
      return { status: 'success', profile: result.data };
    }
    if (result.status === 'conflict')
      return {
        status: 'conflict',
        message:
          'Профиль уже изменён в другой вкладке. Введённые данные сохранены в форме. Загрузите актуальный профиль перед повторным сохранением.',
      };
    return result;
  } catch {
    logError('COMMAND_ERROR', { correlationId: randomUUID() });
    return {
      status: 'unavailable',
      message: 'Не удалось сохранить профиль. Попробуйте ещё раз.',
    };
  }
}
