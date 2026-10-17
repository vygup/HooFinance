import { describe, expect, test } from 'vitest';
import { parseConfig } from '@/server/config';
const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/finance_test',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  APP_ORIGIN: 'http://localhost:3000',
  TOKEN_ENCRYPTION_KEY: 'b'.repeat(64),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'test@example.invalid',
};
describe('Серверная конфигурация', () => {
  test('проверяет валидную конфигурацию', () => {
    expect(parseConfig(env).CSV_MAX_ROWS).toBe(10000);
  });
  test('не раскрывает значения при ошибках', () => {
    const value = 'private-secret';
    try {
      parseConfig({ ...env, BETTER_AUTH_SECRET: value });
      throw new Error('Ожидалась ошибка');
    } catch (error) {
      expect(String(error)).toContain('BETTER_AUTH_SECRET');
      expect(String(error)).not.toContain(value);
    }
  });
  test('требует HTTPS в production', () => {
    expect(() => parseConfig({ ...env, NODE_ENV: 'production' })).toThrow(
      'APP_ORIGIN',
    );
  });
  test('отклоняет несовпадающий origin и некорректные лимиты', () => {
    expect(() =>
      parseConfig({
        ...env,
        BETTER_AUTH_URL: 'https://other.invalid',
        CSV_MAX_BYTES: '0',
      }),
    ).toThrow();
  });
});

test('Некорректный URL возвращает только имя поля, без исходного значения', () => {
  const invalid = 'private-url-secret';
  for (const field of ['DATABASE_URL', 'APP_ORIGIN']) {
    expect(() => parseConfig({ ...env, [field]: invalid })).toThrow(field);
    expect(() => parseConfig({ ...env, [field]: invalid })).not.toThrow(
      invalid,
    );
  }
});

test('Production не может незаметно подменить SMTP тестовым транспортом', () => {
  expect(() =>
    parseConfig({
      ...env,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://finance.example.org',
      BETTER_AUTH_URL: 'https://finance.example.org',
      MAIL_TRANSPORT: 'mock',
    }),
  ).toThrow('MAIL_TRANSPORT');
});
