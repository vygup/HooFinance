import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { testPool } from './setup';
import { createAuth } from '@/server/auth/auth';
import { createMockMailTransport } from '@/server/mail/transport';
import { getConfig } from '@/server/config';
export const integrationDb = drizzle(testPool);
export const mockMail = createMockMailTransport();
export function testAuth() {
  return createAuth(integrationDb, mockMail);
}
export async function authRequest(
  path: string,
  body: unknown,
  cookie?: Headers,
) {
  const c = getConfig();
  const headers = new Headers(cookie);
  headers.set('content-type', 'application/json');
  headers.set('origin', c.APP_ORIGIN);
  return testAuth().handler(
    new Request(`${c.APP_ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}
export async function registeredActor() {
  const email = `test-${randomUUID()}@example.org`;
  const response = await authRequest('/sign-up/email', {
    email,
    password: 'TestStrongPassword123!',
    name: 'Тест',
  });
  if (response.status !== 200)
    throw new Error(`TEST_SIGNUP_FAILED_${response.status}`);
  const data = (await response.json()) as { user: { id: string } };
  const headers = new Headers({
    origin: getConfig().APP_ORIGIN,
    cookie: response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  });
  return {
    actorId: data.user.id,
    headers,
    email,
    password: 'TestStrongPassword123!',
  };
}
