import 'server-only';
import { z } from 'zod';
import { readWorkspaceSnapshot } from '@/server/db/read-snapshot';
import { financialTransaction } from '@/modules/ledger/application/transaction';
import {
  commandEnvelope,
  validationErrors,
  type CommandEnvelope,
} from '@/shared/contracts/commands';
import { savingsPlanInput } from './savings-plan-input';
import {
  persistSavingsPlan,
  projectSavingsPlan,
} from '../infrastructure/savings-plan-repository';
export async function configureSavings(
  headers: Headers,
  envelope: CommandEnvelope,
  input: unknown,
) {
  const p = savingsPlanInput.safeParse(input),
    e = commandEnvelope.safeParse(envelope);
  if (!p.success) return validationErrors(p.error);
  if (!e.success) return validationErrors(e.error);
  return financialTransaction({
    headers,
    envelope: e.data,
    payload: p.data,
    payloadSchema: savingsPlanInput,
    workspaceIds: [e.data.workspaceId],
    accountIds: [],
    execute: async ({ tx, actorId }) => ({
      reference: await persistSavingsPlan(
        tx,
        actorId,
        e.data.workspaceId,
        p.data,
        e.data.expectedVersion,
      ),
    }),
    project: (tx, id, actorId) =>
      projectSavingsPlan(tx, id, e.data.workspaceId, actorId),
  });
}
export async function readSavingsPlan(
  headers: Headers,
  workspaceId: string,
  goalId: string,
) {
  const scope = z.uuid().parse(workspaceId),
    id = z.uuid().parse(goalId);
  return readWorkspaceSnapshot(headers, scope, ({ tx, actorId }) =>
    projectSavingsPlan(tx, id, scope, actorId),
  );
}

/** Read-only preview; never creates a receipt, configuration or financial action. */
export async function previewSavings(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  const scope = z.uuid().parse(workspaceId),
    parsed = savingsPlanInput.parse(input);
  return readWorkspaceSnapshot(headers, scope, async ({ tx, actorId }) => {
    const current = await projectSavingsPlan(tx, parsed.goalId, scope, actorId);
    if (
      parsed.anchorDate < current.today &&
      (!current.configured || parsed.anchorDate !== current.anchorDate)
    )
      throw new z.ZodError([
        { code: 'custom', path: ['anchorDate'], message: 'Проверьте дату' },
      ]);
    const { projectGoal } =
      await import('../infrastructure/reserve-repository');
    const { savingsProjection } = await import('../domain/savings-plan');
    const g = await projectGoal(tx, parsed.goalId, scope, actorId);
    try {
      return savingsProjection({
        currency: g.currency,
        remaining: g.progress.remaining,
        status: g.progress.status,
        today: current.today,
        targetDate: g.targetDate,
        anchorDate: parsed.anchorDate,
        monthlyContribution: parsed.monthlyContribution ?? null,
      });
    } catch {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['monthlyContribution'],
          message: 'Проверьте сумму',
        },
      ]);
    }
  });
}
