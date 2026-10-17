import { z } from 'zod';
import { incomeInput } from './income';
import { transferInput } from './transfers';
import {
  addMoney,
  subtractMoney,
  validateAmount,
} from '@/shared/money/decimal';

export const historyInput = z.discriminatedUnion('command', [
  z.strictObject({
    command: z.literal('updateEntry'),
    actionId: z.uuid(),
    accountId: z.uuid(),
    categoryId: z.uuid(),
    amount: incomeInput.shape.amount,
    financialDate: incomeInput.shape.financialDate,
    description: incomeInput.shape.description,
  }),
  transferInput.safeExtend({
    command: z.literal('updateTransfer'),
    actionId: z.uuid(),
  }),
  z.strictObject({
    command: z.literal('delete'),
    actionId: z.uuid(),
    explicitConfirmation: z.literal(true),
  }),
]);
export type HistoryInput = z.infer<typeof historyInput>;
export const historyFilters = z
  .strictObject({
    from: incomeInput.shape.financialDate.optional(),
    to: incomeInput.shape.financialDate.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    text: z.string().trim().max(2000).optional(),
  })
  .refine((p) => !p.from || !p.to || p.from <= p.to, {
    path: ['to'],
    message: 'Проверьте порядок дат',
  });
export type HistoryFilters = z.infer<typeof historyFilters>;
export type CorrectionLeg = {
  accountId: string;
  currency: string;
  amount: string;
  role: string;
};
export type HistoryLeg = CorrectionLeg & {
  workspaceId: string;
  categoryId: string | null;
  financialDate: string;
  description: string;
};
export type HistoryAction = {
  id: string;
  workspaceId: string;
  kind: string;
  creatorId: string;
  createdAt: string;
  version: string;
  status: string;
  canEdit: boolean;
  legs: HistoryLeg[];
  editLegs: HistoryLeg[];
  revisions: {
    revision: string;
    status: string;
    actorId: string;
    happenedAt: string;
    legs: HistoryLeg[];
  }[];
};

/** Undo the entire current revision, then apply the entire replacement, exactly once. */
export function correctionBalances(
  accounts: readonly {
    id: string;
    currency: string;
    balanceProjection: string;
  }[],
  before: readonly CorrectionLeg[],
  after: readonly CorrectionLeg[],
) {
  for (const leg of [...before, ...after]) {
    const a = accounts.find((a) => a.id === leg.accountId);
    if (
      !a ||
      a.currency !== leg.currency ||
      !['income', 'expense', 'transfer_in', 'transfer_out'].includes(leg.role)
    )
      throw Error('INVALID_CORRECTION');
    validateAmount(leg.amount, leg.currency);
  }
  return accounts.map((account) => {
    let amount = validateAmount(account.balanceProjection, account.currency);
    for (const leg of before.filter((l) => l.accountId === account.id))
      amount = ['income', 'transfer_in'].includes(leg.role)
        ? subtractMoney(amount, leg.amount, account.currency)
        : addMoney([amount, leg.amount], account.currency);
    for (const leg of after.filter((l) => l.accountId === account.id))
      amount = ['income', 'transfer_in'].includes(leg.role)
        ? addMoney([amount, leg.amount], account.currency)
        : subtractMoney(amount, leg.amount, account.currency);
    return { accountId: account.id, currency: account.currency, amount };
  });
}
