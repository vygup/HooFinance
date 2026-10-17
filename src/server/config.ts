import 'server-only';
import { z } from 'zod';
const secret = z
  .string()
  .min(32)
  .refine((v) => !v.includes('CHANGE_ME'), 'Необходимо задать секрет');
const origin = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
});
const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    DATABASE_URL: z
      .url()
      .refine(
        (v) =>
          URL.canParse(v) &&
          ['postgres:', 'postgresql:'].includes(new URL(v).protocol) &&
          !v.includes('CHANGE_ME'),
      ),
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: origin,
    APP_ORIGIN: origin,
    TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    MAIL_TRANSPORT: z.enum(['smtp', 'mock']).default('smtp'),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.email(),
    AUTH_INVITE_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    AUTH_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    AUTH_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),
    AUTH_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    AUTH_RESET_EMAIL_LIMIT: z.coerce.number().int().positive().default(3),
    AUTH_RESET_IP_LIMIT: z.coerce.number().int().positive().default(10),
    AUTH_INVITE_OWNER_LIMIT: z.coerce.number().int().positive().default(10),
    AUTH_INVITE_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600),
    AUTH_INVITE_RECIPIENT_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    TRUSTED_PROXY_SECRET: z.string().default(''),
    CSV_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
    CSV_MAX_ROWS: z.coerce.number().int().positive().default(10000),
    CSV_PREVIEW_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.MAIL_TRANSPORT === 'mock')
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'Mock transport запрещён в production',
      });
    if (value.APP_ORIGIN !== value.BETTER_AUTH_URL)
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'Origin должен совпадать',
      });
    if (
      value.NODE_ENV === 'production' &&
      !value.APP_ORIGIN.startsWith('https://')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'В production необходим HTTPS',
      });
    if (value.TRUST_PROXY && value.TRUSTED_PROXY_SECRET.length < 32)
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXY_SECRET'],
        message: 'Необходимо задать секрет proxy',
      });
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD))
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'Логин и пароль задаются вместе',
      });
  });
export function parseConfig(env: Record<string, string | undefined>) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Не включать входные значения, URL, токены или исходный ZodError в логи.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(
      `Некорректная серверная конфигурация: ${fields.join(', ')}`,
    );
  }
  return result.data;
}
let config: ReturnType<typeof parseConfig> | undefined;
export function getConfig() {
  return (config ??= parseConfig(process.env));
}
