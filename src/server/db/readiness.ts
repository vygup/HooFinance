import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import journal from './migrations/meta/_journal.json';
import { getPool } from './client';
export async function isDatabaseReady(): Promise<boolean> {
  const expected = await Promise.all(
    journal.entries.map(async (entry) => ({
      created_at: String(entry.when),
      hash: createHash('sha256')
        .update(await readFile(`src/server/db/migrations/${entry.tag}.sql`))
        .digest('hex'),
    })),
  );
  const result = await getPool().query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  return (
    expected.length > 0 &&
    result.rows.length === expected.length &&
    expected.every(
      (entry, index) =>
        entry.created_at === result.rows[index]?.created_at &&
        entry.hash === result.rows[index]?.hash,
    )
  );
}
