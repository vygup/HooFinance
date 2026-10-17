import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
/** Later-story operations are valid committed fixtures, not an alternate application write path. */
export async function seedAccountHistory(
  pool: Pool,
  workspaceId: string,
  accountId: string,
  actorId: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [kind, amount, date] of [
      ['income', '20000.00', '2026-10-01'],
      ['expense', '3000.00', '2026-10-02'],
    ]) {
      const actionId = randomUUID(),
        categoryId = randomUUID();
      await client.query(
        'INSERT INTO category(id,workspace_id,name,kind) VALUES($1,$2,$3,$4)',
        [categoryId, workspaceId, kind, kind],
      );
      await client.query(
        "INSERT INTO financial_action(id,creator_id,kind,current_revision,status) VALUES($1,$2,$3,1,'active')",
        [actionId, actorId, kind],
      );
      await client.query(
        "INSERT INTO action_revision(action_id,revision_no,actor_id,status) VALUES($1,1,$2,'active')",
        [actionId, actorId],
      );
      await client.query(
        "INSERT INTO ledger_leg(workspace_id,action_id,revision_no,account_id,role,amount,currency,financial_date,category_id) VALUES($1,$2,1,$3,$4,$5,'RUB',$6,$7)",
        [workspaceId, actionId, accountId, kind, amount, date, categoryId],
      );
    }
    await client.query(
      'UPDATE financial_account SET balance_projection=opening_balance+17000 WHERE id=$1',
      [accountId],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
