import { accountTotals } from '@/modules/ledger/domain/accounts';
import { validateAmount } from '@/shared/money/decimal';
import { summarizeAnalytics, type AnalyticsRow } from './analytics';
/** Goal and reserve amounts are views of accounts, never additional balances. */
export function summarizeDashboard(
  accounts: readonly { currency: string; balance: string }[],
  rows: readonly AnalyticsRow[],
  budgetCurrencies: readonly string[],
) {
  const totals = summarizeAnalytics(rows).totals;
  const currencies = [
    ...new Set([
      ...accounts.map((a) => a.currency),
      ...totals.map((t) => t.currency),
      ...budgetCurrencies,
    ]),
  ].sort();
  return {
    balances: accountTotals(accounts),
    monthly: currencies.map(
      (currency) =>
        totals.find((t) => t.currency === currency) ?? {
          currency,
          income: validateAmount('0', currency),
          expense: validateAmount('0', currency),
          difference: validateAmount('0', currency),
        },
    ),
  };
}
