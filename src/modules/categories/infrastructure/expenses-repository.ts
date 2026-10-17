import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db/client';
import { category } from '@/server/db/schema/categories';
import { scopedAuditEvent } from '@/server/db/schema/ledger';
import { AccessError, requireWorkspace } from '@/server/security/access';
import { CommandConflict } from '@/modules/ledger/application/transaction';
import type { CategoryInput, CategoryDto } from '../domain/expenses';
export function categoryDto(row: typeof category.$inferSelect): CategoryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind,
    archived: !!row.archivedAt,
    version: row.version.toString(),
  };
}
export async function projectCategory(
  tx: Transaction,
  id: string,
  workspaceId: string,
  actorId: string,
) {
  await requireWorkspace(actorId, workspaceId, 'read', tx);
  const [row] = await tx
    .select()
    .from(category)
    .where(and(eq(category.id, id), eq(category.workspaceId, workspaceId)));
  if (!row) throw new AccessError();
  return categoryDto(row);
}
export async function saveCategory(
  tx: Transaction,
  actorId: string,
  workspaceId: string,
  input: CategoryInput,
  expectedVersion?: string,
) {
  let before: CategoryDto | null = null;
  let row: typeof category.$inferSelect | undefined;
  if (input.command === 'create') {
    [row] = await tx
      .insert(category)
      .values({ workspaceId, name: input.name, kind: input.kind })
      .returning();
  } else {
    const [old] = await tx
      .select()
      .from(category)
      .where(
        and(eq(category.id, input.id), eq(category.workspaceId, workspaceId)),
      )
      .for('update');
    if (!old) throw new AccessError();
    if (old.version.toString() !== expectedVersion) throw new CommandConflict();
    before = categoryDto(old);
    [row] = await tx
      .update(category)
      .set({
        ...(input.command === 'update'
          ? { name: input.name }
          : { archivedAt: new Date() }),
        version: old.version + 1n,
      })
      .where(
        and(eq(category.id, old.id), eq(category.workspaceId, workspaceId)),
      )
      .returning();
  }
  if (!row) throw Error('WRITE_FAILED');
  await tx.insert(scopedAuditEvent).values({
    workspaceId,
    objectType: 'category',
    objectId: row.id,
    actorId,
    revisionNo: Number(row.version),
    kind: input.command,
    beforeScope: before,
    afterScope: categoryDto(row),
  });
  return row.id;
}
