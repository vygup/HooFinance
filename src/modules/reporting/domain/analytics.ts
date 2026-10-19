import Decimal from 'decimal.js';
import { chartCoordinate } from '@/shared/chart-coordinate';
import { addMoney, subtractMoney } from '@/shared/money/decimal';
import { reportPeriod } from '@/shared/calendar/calendar';
type AnalyticsInput =
  | { period: 'current' | 'previous' | 'year' }
  | { period: 'custom'; from: string; until: string };
export function analyticsPeriod(input: AnalyticsInput, today: string) {
  return input.period === 'custom'
    ? { from: input.from, until: input.until }
    : reportPeriod(input.period, today);
}
export type AnalyticsRow = {
  role: string;
  amount: string;
  currency: string;
  financialDate: string;
  categoryId: string | null;
  categoryName: string | null;
};
export function summarizeAnalytics(rows: readonly AnalyticsRow[]) {
  const entries = rows.filter(
    (r) => r.role === 'income' || r.role === 'expense',
  );
  const totals = [...new Set(entries.map((r) => r.currency))]
    .sort()
    .map((currency) => {
      const income = addMoney(
        entries
          .filter((r) => r.currency === currency && r.role === 'income')
          .map((r) => r.amount),
        currency,
      );
      const expense = addMoney(
        entries
          .filter((r) => r.currency === currency && r.role === 'expense')
          .map((r) => r.amount),
        currency,
      );
      return {
        currency,
        income,
        expense,
        difference: subtractMoney(income, expense, currency),
      };
    });
  const groups = new Map<string, AnalyticsRow[]>();
  for (const row of entries) {
    const key = JSON.stringify([row.currency, row.role, row.categoryId]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const categories = [...groups.values()]
    .map((group) => ({
      currency: group[0]!.currency,
      role: group[0]!.role,
      categoryId: group[0]!.categoryId,
      name: group[0]!.categoryName ?? 'Без категории',
      amount: addMoney(
        group.map((r) => r.amount),
        group[0]!.currency,
      ),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency),
    );
  // Only ratios are converted to numbers for Recharts; exact monetary strings remain authoritative.
  const chart = categories.map((c) => ({
    ...c,
    coordinate: chartCoordinate(
      c.amount,
      totals.find((t) => t.currency === c.currency)![
        c.role === 'income' ? 'income' : 'expense'
      ],
    ),
  }));
  const days = [...new Set(entries.map((r) => r.financialDate))].sort();
  const dynamics = days.flatMap((date) =>
    totals.flatMap((t) => {
      const day = entries.filter(
        (r) => r.financialDate === date && r.currency === t.currency,
      );
      if (!day.length) return [];
      const income = addMoney(
        day.filter((r) => r.role === 'income').map((r) => r.amount),
        t.currency,
      );
      const expense = addMoney(
        day.filter((r) => r.role === 'expense').map((r) => r.amount),
        t.currency,
      );
      const max = Decimal.max(t.income, t.expense, '1');
      return [
        {
          date,
          currency: t.currency,
          income,
          expense,
          incomeCoordinate: chartCoordinate(income, max.toFixed()),
          expenseCoordinate: chartCoordinate(expense, max.toFixed()),
        },
      ];
    }),
  );
  return { totals, categories: chart, dynamics };
}
