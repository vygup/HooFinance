import Decimal from 'decimal.js';
import {
  addMoney,
  subtractMoney,
  validateAmount,
} from '@/shared/money/decimal';
export const accountTypes = {
  cash: 'Наличные',
  bank_card: 'Банковская карта',
  accumulation: 'Накопительный',
  savings: 'Сберегательный',
  reserve: 'Резервный',
  other: 'Другой денежный счёт',
} as const;
export function correctOpeningBalance(
  balance: string,
  previous: string,
  next: string,
  currency: string,
) {
  return addMoney(
    [
      balance,
      subtractMoney(validateAmount(next, currency), previous, currency),
    ],
    currency,
  );
}
export function needsNegativeWarning(previous: string, next: string) {
  return new Decimal(next).isNegative() && new Decimal(next).lt(previous);
}
export function accountTotals(
  accounts: readonly { currency: string; balance: string }[],
) {
  const grouped = new Map<string, string[]>();
  for (const a of accounts)
    grouped.set(a.currency, [...(grouped.get(a.currency) ?? []), a.balance]);
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, values]) => ({
      currency,
      amount: addMoney(values, currency),
    }));
}
export function historyBalances(
  opening: string,
  currency: string,
  legs: readonly { amount: string; role: string }[],
) {
  let balance = validateAmount(opening, currency);
  return legs.map((leg) => {
    balance = ['income', 'transfer_in'].includes(leg.role)
      ? addMoney([balance, leg.amount], currency)
      : subtractMoney(balance, leg.amount, currency);
    return balance;
  });
}
export type AccountDto = {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  balance: string;
  description: string;
  archived: boolean;
  version: string;
  history: {
    id: string;
    date: string;
    role: string;
    amount: string;
    balance: string;
    description: string;
  }[];
  audit: {
    id: string;
    kind: string;
    actorId: string;
    occurredAt: string;
    before: unknown;
    after: unknown;
  }[];
};
