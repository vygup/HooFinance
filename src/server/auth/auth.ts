import 'server-only';
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { ownerAc, memberAc } from 'better-auth/plugins/organization/access';
import { authStorageAdapter, type UserProvisioning } from './storage-adapter';
import { encryptToken } from '@/server/security/encryption';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { getConfig } from '@/server/config';
import { getDb, type Database, type Transaction } from '@/server/db/client';
import { getMailTransport, type MailTransport } from '@/server/mail/transport';
import { organizationContext } from './context';
import { provisionPersonal } from '@/modules/identity/infrastructure/registration-repository';
import { registrationInput } from '@/modules/identity/application/registration-input';
import {
  normalizeEmail,
  trustedClientIp,
  reserveRateLimits,
  releaseRateLimit,
  loginPolicy,
  resetPolicies,
  invitationPolicies,
  RateLimitError,
} from './rate-limits';
const rawPaths = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/sign-out',
  '/get-session',
  '/request-password-reset',
  '/reset-password',
]);
export function createAuth(
  db: Database | Transaction = getDb(),
  mail: MailTransport = getMailTransport(),
  bound = false,
  provisionUser: UserProvisioning = provisionPersonal,
) {
  const c = getConfig();
  return betterAuth({
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    trustedOrigins: [c.APP_ORIGIN],
    database: authStorageAdapter(db, bound, provisionUser),
    logger: { disabled: true },
    telemetry: { enabled: false },
    advanced: { useSecureCookies: c.NODE_ENV === 'production' },
    session: { cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: c.AUTH_RESET_TTL_SECONDS,
      sendResetPassword: async ({ user, url }) => {
        await mail.send({
          to: user.email,
          subject: 'Восстановление пароля Finance Manager',
          text: `Для восстановления пароля откройте ссылку: ${url}`,
        });
      },
    },
    plugins: [
      organization({
        roles: { owner: ownerAc, member: memberAc },
        creatorRole: 'owner',
        membershipLimit: Number.MAX_SAFE_INTEGER,
        invitationLimit: Number.MAX_SAFE_INTEGER,
        allowUserToCreateOrganization: true,
        disableOrganizationDeletion: true,
        invitationExpiresIn: c.AUTH_INVITE_TTL_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ id, email }) => {
          const token = encryptToken(id, 'invitation-link');
          await mail.send({
            to: email,
            subject: 'Приглашение в Finance Manager',
            text: `Для принятия приглашения откройте ссылку: ${c.APP_ORIGIN}/invitations/accept?token=${encodeURIComponent(token)}`,
          });
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path;
        if (path.startsWith('/organization/')) {
          const scope = organizationContext.getStore();
          if (
            !bound ||
            !scope ||
            !scope.paths.includes(path) ||
            path.includes('update-member-role') ||
            path.includes('delete')
          )
            throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
          if (
            path === '/organization/invite-member' &&
            ctx.body?.role !== 'member'
          )
            throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
          if (ctx.body?.userId && ctx.body.userId !== scope.actorId)
            throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
          if (path === '/organization/invite-member' && ctx.body)
            ctx.body.resend = false;
          if (scope.organizationId) {
            if (ctx.body?.invitationId) {
              const invite = await ctx.context.adapter.findOne<{
                organizationId: string;
              }>({
                model: 'invitation',
                where: [{ field: 'id', value: String(ctx.body.invitationId) }],
              });
              if (!invite || invite.organizationId !== scope.organizationId)
                throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
            }
            if (ctx.body && !ctx.body.organizationId)
              ctx.body.organizationId = scope.organizationId;
          }
          const queried = ctx.query?.organizationId;
          if (
            queried &&
            scope.organizationId &&
            queried !== scope.organizationId
          )
            throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
          const requested = ctx.body?.organizationId;
          if (
            requested &&
            scope.organizationId &&
            requested !== scope.organizationId
          )
            throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
        } else if (!rawPaths.has(path) && !path.startsWith('/reset-password/'))
          throw new APIError('FORBIDDEN', { message: 'FORBIDDEN' });
        if (path === '/sign-up/email') {
          const parsed = registrationInput.safeParse({
            name: ctx.body?.name,
            email: ctx.body?.email,
            password: ctx.body?.password,
          });
          if (!parsed.success)
            throw new APIError('BAD_REQUEST', { message: 'INVALID_INPUT' });
          Object.assign(ctx.body, parsed.data);
        }
        if (typeof ctx.body?.email === 'string')
          ctx.body.email = normalizeEmail(ctx.body.email);
        try {
          if (path === '/sign-in/email') {
            const reservation = await reserveRateLimits(
              loginPolicy(
                trustedClientIp(ctx.headers ?? new Headers()),
                String(ctx.body?.email ?? ''),
              ),
            );
            Object.assign(ctx.context, {
              financeLoginReservation: reservation,
            });
          }
          if (path === '/request-password-reset')
            await reserveRateLimits(
              resetPolicies(
                trustedClientIp(ctx.headers ?? new Headers()),
                String(ctx.body?.email ?? ''),
              ),
            );
          const scope = organizationContext.getStore();
          if (path === '/organization/invite-member' && scope)
            await reserveRateLimits(
              invitationPolicies(scope.actorId, String(ctx.body?.email ?? '')),
            );
        } catch (error) {
          if (error instanceof RateLimitError)
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'RATE_LIMITED',
            });
          throw error;
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const reservation = (
          ctx.context as typeof ctx.context & {
            financeLoginReservation?: { id: string; keys: string[] };
          }
        ).financeLoginReservation;
        if (
          ctx.path === '/sign-in/email' &&
          reservation &&
          !(ctx.context.returned instanceof APIError)
        )
          await releaseRateLimit(reservation);
      }),
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}
