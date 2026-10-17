import { z } from 'zod';
import Decimal from 'decimal.js';
import { incomeInput } from './income';
import {
  addMoney,
  subtractMoney,
  validateAmount,
} from '@/shared/money/decimal';
export const transferInput = z
  .strictObject({
    sourceWorkspaceId: z.uuid(),
    destinationWorkspaceId: z.uuid(),
    sourceAccountId: z.uuid(),
    destinationAccountId: z.uuid(),
    debitAmount: incomeInput.shape.amount,
    creditAmount: incomeInput.shape.amount,
    financialDate: incomeInput.shape.financialDate,
    sourceDescription: incomeInput.shape.description,
    destinationDescription: incomeInput.shape.description,
  })
  .refine((p) => p.sourceAccountId !== p.destinationAccountId, {
    path: ['destinationAccountId'],
    message: 'Выберите разные счета',
  });
export type TransferInput = z.infer<typeof transferInput>;
export type TransferDto = {
  id: string;
  workspaceId: string;
  version: string;
  legs: {
    id: string;
    accountId: string;
    role: string;
    amount: string;
    currency: string;
    financialDate: string;
    description: string | null;
  }[];
};
export type TransferAccountOption = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  kind: string;
  name: string;
  currency: string;
};
export function acceptTransfer(
  sourceBalance: string,
  destinationBalance: string,
  sourceCurrency: string,
  destinationCurrency: string,
  debitAmount: string,
  creditAmount: string,
) {
  if (sourceCurrency !== destinationCurrency) throw Error('FX_NOT_AVAILABLE');
  const debit = validateAmount(debitAmount, sourceCurrency),
    credit = validateAmount(creditAmount, destinationCurrency);
  if (!new Decimal(debit).gt('0') || !new Decimal(credit).eq(debit))
    throw Error('INVALID_TRANSFER');
  return {
    debit,
    credit,
    sourceBalance: subtractMoney(sourceBalance, debit, sourceCurrency),
    destinationBalance: addMoney(
      [destinationBalance, credit],
      destinationCurrency,
    ),
    rateNumerator: debit,
    rateDenominator: credit,
    rateDecimal: '1',
  };
}
