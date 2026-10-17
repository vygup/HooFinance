import type { Transaction } from '@/server/db/client';
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { financialAccount } from '@/server/db/schema/accounts';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { AccessError } from '@/server/security/access';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
  type CommandResult,
} from '@/shared/contracts/commands';
import { validateAmount } from '@/shared/money/decimal';
import { accountInput } from './accounts-input';
import {
  accountTotals,
  correctOpeningBalance,
  needsNegativeWarning,
  type AccountDto,
} from '../domain/accounts';
import {
  projectAccount,
  saveAccount,
} from '../infrastructure/accounts-repository';
import {
  financialTransaction,
  CommandConflict,
  CommandValidation,
} from './transaction';
export async function accountCommand(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
): Promise<CommandResult<AccountDto>> {
  const parsed = accountInput.safeParse(input);
  if (!parsed.success) return validationErrors(parsed.error);
  const e = commandEnvelope.safeParse(envelope);
  if (!e.success) return validationErrors(e.error);
  const payload = parsed.data;
  return financialTransaction({
    headers,
    envelope: e.data,
    payload,
    payloadSchema: accountInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: payload.command === 'create' ? [] : [payload.accountId],
    allowArchivedAccounts: true,
    execute: async ({ tx, actorId, accounts, confirmed }) => {
      if (payload.command === 'create') {
        const openingBalance = validateAmount(
          payload.openingBalance,
          payload.currency,
        );
        const [row] = await tx
          .insert(financialAccount)
          .values({
            workspaceId: e.data.workspaceId,
            name: payload.name,
            type: payload.type,
            currency: payload.currency,
            description: payload.description,
            openingBalance,
            balanceProjection: openingBalance,
          })
          .returning();
        if (!row) throw new Error('WRITE_FAILED');
        await saveAccount(tx, actorId, 'create', undefined, row);
        return { reference: row.id };
      }
      const row = accounts[0];
      if (!row || row.workspaceId !== e.data.workspaceId)
        throw new AccessError();
      if (
        !e.data.expectedVersion ||
        row.version.toString() !== e.data.expectedVersion
      )
        throw new CommandConflict();
      let changes: Partial<typeof financialAccount.$inferInsert>;
      if (payload.command === 'correctOpening') {
        let openingBalance: string;
        try {
          openingBalance = validateAmount(payload.openingBalance, row.currency);
        } catch {
          throw new CommandValidation({
            openingBalance: ['Проверьте точность суммы для валюты счёта'],
          });
        }
        const balanceProjection = correctOpeningBalance(
          row.balanceProjection,
          row.openingBalance,
          openingBalance,
          row.currency,
        );
        if (
          needsNegativeWarning(row.balanceProjection, balanceProjection) &&
          !confirmed
        )
          return {
            confirmationBalances: [
              {
                accountId: row.id,
                amount: balanceProjection,
                currency: row.currency,
              },
            ],
          };
        changes = { openingBalance, balanceProjection };
      } else if (payload.command === 'update')
        changes = {
          name: payload.name,
          type: payload.type,
          description: payload.description,
        };
      else changes = { archivedAt: row.archivedAt ?? new Date() };
      const [updated] = await tx
        .update(financialAccount)
        .set({ ...changes, version: row.version + 1n })
        .where(
          and(
            eq(financialAccount.id, row.id),
            eq(financialAccount.workspaceId, e.data.workspaceId),
          ),
        )
        .returning();
      if (!updated) throw new AccessError();
      await saveAccount(tx, actorId, payload.command, row, updated);
      return { reference: row.id };
    },
    project: (tx, id, actorId) =>
      projectAccount(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readAccounts(headers: Headers, workspaceId: string) {
  if (!commandEnvelope.shape.workspaceId.safeParse(workspaceId).success)
    throw new AccessError();
  return readWorkspaceSnapshot(headers, workspaceId, ({ tx, actorId }) =>
    readAccountsInSnapshot(tx, workspaceId, actorId),
  );
}
export async function readAccountsInSnapshot(
  tx: Transaction,
  workspaceId: string,
  actorId: string,
) {
  const rows = await tx
    .select({ id: financialAccount.id })
    .from(financialAccount)
    .where(eq(financialAccount.workspaceId, workspaceId))
    .orderBy(financialAccount.name, financialAccount.id);
  const accounts: AccountDto[] = [];
  for (const row of rows)
    accounts.push(await projectAccount(tx, row.id, workspaceId, actorId));
  return {
    accounts,
    availableAccounts: accounts
      .filter((a) => !a.archived)
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    totals: accountTotals(accounts),
  };
}
