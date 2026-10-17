import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { BetterAuthOptions } from 'better-auth';
import type { Database, Transaction } from '@/server/db/client';
import * as schema from '@/server/db/schema/identity';
import {
  encryptSessionLookup,
  decryptToken,
} from '@/server/security/encryption';
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export type UserProvisioning = (
  user: { id: string },
  tx: Transaction,
) => Promise<void>;
const authTransactionContext = new AsyncLocalStorage<Transaction>();
export function authStorageAdapter(
  db: Database | Transaction,
  bound = false,
  provisionUser?: UserProvisioning,
) {
  if (bound && !('rollback' in db))
    throw new Error('AUTH_TRANSACTION_REQUIRED');
  return (options: BetterAuthOptions) => {
    const adapter = drizzleAdapter(db, {
      provider: 'pg',
      schema,
      transaction: false,
    })(options);
    function wrap(target: typeof adapter): typeof adapter {
      return new Proxy(target, {
        get(object, property, receiver) {
          const method = Reflect.get(object, property, receiver);
          if (typeof method !== 'function') return method;
          if (property === 'transaction')
            return (callback: (child: typeof adapter) => Promise<unknown>) => {
              if (bound)
                return authTransactionContext.run(db as Transaction, () =>
                  callback(receiver as typeof adapter),
                );
              return (db as Database).transaction((tx) =>
                authTransactionContext.run(tx, () =>
                  callback(
                    authStorageAdapter(tx, true, provisionUser)(options),
                  ),
                ),
              );
            };
          return async (...args: unknown[]) => {
            const input = args[0];
            const provisioning =
              provisionUser &&
              property === 'create' &&
              record(input) &&
              input.model === 'user';
            const currentTx = authTransactionContext.getStore();
            if (provisioning && !currentTx)
              throw new Error('AUTH_TRANSACTION_REQUIRED');
            const session = record(input) && input.model === 'session';
            if (session) {
              const transformed = { ...input };
              if (record(input.data) && typeof input.data.token === 'string')
                transformed.data = {
                  ...input.data,
                  token: encryptSessionLookup(input.data.token),
                };
              if (
                record(input.update) &&
                typeof input.update.token === 'string'
              )
                transformed.update = {
                  ...input.update,
                  token: encryptSessionLookup(input.update.token),
                };
              if (Array.isArray(input.where))
                transformed.where = input.where.map((condition) => {
                  if (!record(condition) || condition.field !== 'token')
                    return condition;
                  const value = condition.value;
                  return {
                    ...condition,
                    value:
                      typeof value === 'string'
                        ? encryptSessionLookup(value)
                        : Array.isArray(value)
                          ? value.map((v) =>
                              typeof v === 'string'
                                ? encryptSessionLookup(v)
                                : v,
                            )
                          : value,
                  };
                });
              args[0] = transformed;
            }
            const result: unknown = await Reflect.apply(method, object, args);
            if (
              provisioning &&
              currentTx &&
              record(result) &&
              typeof result.id === 'string'
            )
              await provisionUser({ id: result.id }, currentTx);
            if (!session) return result;
            const decode = (row: unknown): unknown =>
              record(row) && typeof row.token === 'string'
                ? { ...row, token: decryptToken(row.token, 'session-storage') }
                : row;
            return Array.isArray(result) ? result.map(decode) : decode(result);
          };
        },
      });
    }
    return wrap(adapter);
  };
}
