import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { isIP } from 'node:net';
import { getConfig } from '@/server/config';
import { getDb, type Database } from '@/server/db/client';
import { authRateBucket } from '@/server/db/schema/auth-rate-limits';
export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
export function trustedClientIp(headers: Headers) {
  const c = getConfig(),
    supplied = headers.get('x-finance-proxy-secret') ?? '';
  const a = Buffer.from(supplied),
    b = Buffer.from(c.TRUSTED_PROXY_SECRET);
  if (!c.TRUST_PROXY || a.length !== b.length || !timingSafeEqual(a, b))
    return 'untrusted';
  const ip = headers.get('x-finance-client-ip') ?? '';
  return isIP(ip) ? ip : 'untrusted';
}
export class RateLimitError extends Error {
  constructor() {
    super('RATE_LIMITED');
  }
}
export type RatePolicy = {
  action: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export async function reserveRateLimits(
  policies: readonly RatePolicy[],
  db: Database = getDb(),
  now = new Date(),
) {
  const secret = getConfig().BETTER_AUTH_SECRET;
  const id = randomUUID();
  const keys = policies
    .map((policy) => ({
      ...policy,
      key: createHmac('sha256', secret)
        .update(`${policy.action}\0${policy.subject}`)
        .digest('hex'),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  await db.transaction(async (tx) => {
    for (const policy of keys) {
      const expiresAt = new Date(now.getTime() + policy.windowSeconds * 1000);
      await tx
        .insert(authRateBucket)
        .values({
          id: policy.key,
          action: policy.action,
          subjectHash: policy.key,
          windowStartedAt: now,
          attemptTimestamps: [],
          expiresAt,
        })
        .onConflictDoNothing();
      const [bucket] = await tx
        .select()
        .from(authRateBucket)
        .where(eq(authRateBucket.id, policy.key))
        .for('update');
      if (!bucket) throw new Error('RATE_BUCKET_UNAVAILABLE');
      const attempts = bucket.attemptTimestamps.filter(
        (entry) =>
          new Date(entry.at).getTime() >
          now.getTime() - policy.windowSeconds * 1000,
      );
      if (attempts.length >= policy.limit) throw new RateLimitError();
      attempts.push({ id, at: now.toISOString() });
      await tx
        .update(authRateBucket)
        .set({
          attemptTimestamps: attempts,
          windowStartedAt: new Date(attempts[0]?.at ?? now),
          expiresAt,
        })
        .where(eq(authRateBucket.id, policy.key));
    }
  });
  return { id, keys: keys.map((p) => p.key) };
}
export async function releaseRateLimit(
  reservation: { id: string; keys: string[] },
  db: Database = getDb(),
) {
  await db.transaction(async (tx) => {
    for (const key of [...reservation.keys].sort()) {
      const [bucket] = await tx
        .select()
        .from(authRateBucket)
        .where(eq(authRateBucket.id, key))
        .for('update');
      if (bucket)
        await tx
          .update(authRateBucket)
          .set({
            attemptTimestamps: bucket.attemptTimestamps.filter(
              (entry) => entry.id !== reservation.id,
            ),
          })
          .where(eq(authRateBucket.id, key));
    }
  });
}
export function loginPolicy(ip: string, email: string): RatePolicy[] {
  const c = getConfig();
  return [
    {
      action: 'login',
      subject: `${ip}\0${normalizeEmail(email)}`,
      limit: c.AUTH_LOGIN_LIMIT,
      windowSeconds: c.AUTH_WINDOW_SECONDS,
    },
  ];
}
export function resetPolicies(ip: string, email: string): RatePolicy[] {
  const c = getConfig();
  return [
    {
      action: 'reset-email',
      subject: normalizeEmail(email),
      limit: c.AUTH_RESET_EMAIL_LIMIT,
      windowSeconds: c.AUTH_WINDOW_SECONDS,
    },
    {
      action: 'reset-ip',
      subject: ip,
      limit: c.AUTH_RESET_IP_LIMIT,
      windowSeconds: c.AUTH_WINDOW_SECONDS,
    },
  ];
}
export function invitationPolicies(
  ownerId: string,
  email: string,
): RatePolicy[] {
  const c = getConfig();
  return [
    {
      action: 'invite-owner',
      subject: ownerId,
      limit: c.AUTH_INVITE_OWNER_LIMIT,
      windowSeconds: c.AUTH_INVITE_WINDOW_SECONDS,
    },
    {
      action: 'invite-recipient',
      subject: normalizeEmail(email),
      limit: 1,
      windowSeconds: c.AUTH_INVITE_RECIPIENT_SECONDS,
    },
  ];
}
