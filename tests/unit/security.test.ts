import { expect, test, vi } from 'vitest';
vi.mock('@/server/config', () => ({
  getConfig: () => ({
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    TRUST_PROXY: true,
    TRUSTED_PROXY_SECRET: 'p'.repeat(32),
  }),
}));
import {
  encryptToken,
  decryptToken,
  encryptSessionLookup,
} from '@/server/security/encryption';
import { projectLeg, projectAuthPayload } from '@/server/security/projection';
import { trustedClientIp, normalizeEmail } from '@/server/auth/rate-limits';
import { logError } from '@/server/security/logging';
import { createMockMailTransport } from '@/server/mail/transport';
test('AES-GCM шифрует и связывает ciphertext с назначением; tamper отклоняется', () => {
  const encrypted = encryptToken('private-token', 'invite');
  expect(encrypted).not.toContain('private-token');
  expect(decryptToken(encrypted, 'invite')).toBe('private-token');
  expect(encryptToken('private-token', 'invite')).not.toBe(encrypted);
  expect(() => decryptToken(encrypted, 'reset')).toThrow('INVALID_TOKEN');
  expect(() => decryptToken(`${encrypted.slice(0, -2)}xx`, 'invite')).toThrow(
    'INVALID_TOKEN',
  );
  expect(encryptSessionLookup('random-session')).toBe(
    encryptSessionLookup('random-session'),
  );
  expect(
    decryptToken(encryptSessionLookup('random-session'), 'session-storage'),
  ).toBe('random-session');
});
test('DTO не раскрывает чужую leg и не включает системные transfer поля', () => {
  const leg = {
    id: 'leg',
    workspaceId: 'mine',
    accountId: 'account',
    amount: '100',
    currency: 'RUB',
    financialDate: '2026-10-17',
    role: 'transfer_in',
    privateDescription: null,
  };
  expect(() => projectLeg(leg, 'other')).toThrow('FORBIDDEN');
  expect(projectLeg(leg, 'mine')).not.toHaveProperty('workspaceId');
});
test('Произвольные forwarded headers не меняют IP', () => {
  expect(
    trustedClientIp(
      new Headers({
        'x-forwarded-for': '1.2.3.4',
        'x-finance-client-ip': '1.2.3.4',
      }),
    ),
  ).toBe('untrusted');
  expect(
    trustedClientIp(
      new Headers({
        'x-finance-proxy-secret': 'p'.repeat(32),
        'x-finance-client-ip': '1.2.3.4',
      }),
    ),
  ).toBe('1.2.3.4');
  expect(normalizeEmail(' A.B+test@Example.org ')).toBe('a.b+test@example.org');
});
test('Mock SMTP валидирует адреса и не отправляет письма', async () => {
  const mail = createMockMailTransport();
  await mail.send({ to: 'a@example.org', subject: 'Тест', text: 'Тест' });
  expect(mail.messages).toHaveLength(1);
  await expect(
    mail.send({ to: 'bad', subject: 'Тест', text: 'Тест' }),
  ).rejects.toThrow();
});

test('Logger записывает только разрешённые поля без payload, токенов и ошибок', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const context = {
      correlationId: 'test-correlation',
      actorId: 'actor',
      workspaceId: 'workspace',
      token: 'private-secret',
      amount: '12345.67',
      error: new Error('private-secret'),
    };
    logError('COMMAND_ERROR', context);
    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({
        code: 'COMMAND_ERROR',
        correlationId: 'test-correlation',
        actorId: 'actor',
        workspaceId: 'workspace',
      }),
    );
  } finally {
    spy.mockRestore();
  }
});

test('Публичный auth DTO не раскрывает токены HttpOnly сессии', () => {
  expect(
    projectAuthPayload({
      token: 'private-token',
      session: {
        id: 'session',
        token: 'private-token',
        userId: 'user',
        ipAddress: 'private-ip',
      },
      user: { id: 'user' },
    }),
  ).toEqual({
    session: { id: 'session', userId: 'user' },
    user: { id: 'user' },
  });
  expect(projectAuthPayload(null)).toBeNull();
});
