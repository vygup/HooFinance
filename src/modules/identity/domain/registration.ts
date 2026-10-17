import { z } from 'zod';
const name = z
  .string()
  .trim()
  .min(1, 'Введите имя')
  .max(100, 'Не более 100 символов');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Введите корректную почту'));
const password = z
  .string()
  .min(8, 'Не менее 8 символов')
  .max(128, 'Не более 128 символов');
const locale = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf([value]).length === 1;
    } catch {
      return false;
    }
  }, 'Укажите поддерживаемую локаль, например ru-RU');
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      if (/^[+-]/.test(value)) return false;
      new Intl.DateTimeFormat('ru-RU', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Укажите часовой пояс, например Europe/Moscow');
export const registrationInput = z.strictObject({ name, email, password });
export const loginInput = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});
export const recoveryInput = z.strictObject({ email });
export const resetInput = z.strictObject({
  token: z.string().min(1).max(512),
  newPassword: password,
});
export const profileInput = z.strictObject({
  name,
  locale,
  timezone,
  expectedVersion: z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(19)
    .refine(
      (v) =>
        /^[1-9]\d*$/.test(v) &&
        v.length <= 19 &&
        BigInt(v) < 9223372036854775807n,
      'Недопустимая версия',
    ),
});
export type ProfileDto = {
  name: string;
  email: string;
  locale: string;
  timezone: string;
  version: string;
};
