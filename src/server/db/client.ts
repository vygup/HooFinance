import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getConfig } from '@/server/config';
const globalDb = globalThis as typeof globalThis & { financePool?: Pool };
export function getPool() {
  if (!globalDb.financePool) {
    const pool = new Pool({
      connectionString: getConfig().DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    pool.on('error', () => {
      console.error('DATABASE_POOL_ERROR');
    });
    globalDb.financePool = pool;
  }
  return globalDb.financePool;
}
export function getDb() {
  return drizzle(getPool());
}

export type Database = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
