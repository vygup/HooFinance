import { validateAmount } from '@/shared/money/decimal';
export type HistoryRow = {
  id: string;
  revision: number;
  type: string;
  date: string;
  account: string;
  currency: string;
  amount: string;
  category: string;
  description: string;
  transferId: string;
  direction: string;
  counterpartyAccount: string;
  counterpartyCurrency: string;
  counterpartyAmount: string;
  rateNumerator: string;
  rateDenominator: string;
};
const columns = [
  'format_version',
  'operation_id',
  'revision',
  'type',
  'date',
  'account',
  'currency',
  'amount',
  'category',
  'description',
  'transfer_id',
  'direction',
  'counterparty_account',
  'counterparty_currency',
  'counterparty_amount',
  'rate_numerator',
  'rate_denominator',
];
function quote(value: string) {
  const dangerous =
    /^[\s\p{Cc}]*[=+\-@']/u.test(value) || /^[\s\p{Cc}]*[\t\r]/u.test(value);
  return '"' + (dangerous ? "'" + value : value).replaceAll('"', '""') + '"';
}
export function encodeHistoryCsv(rows: readonly HistoryRow[]) {
  rows.forEach((r) => {
    validateAmount(r.amount, r.currency);
    if (r.counterpartyAmount)
      validateAmount(r.counterpartyAmount, r.counterpartyCurrency);
    for (const value of [r.rateNumerator, r.rateDenominator]) {
      if (value && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
        throw new Error('INVALID_DECIMAL');
    }
  });
  const lines = rows.map((r) =>
    [
      '1',
      r.id,
      String(r.revision),
      r.type,
      r.date,
      r.account,
      r.currency,
      r.amount,
      r.category,
      r.description,
      r.transferId,
      r.direction,
      r.counterpartyAccount,
      r.counterpartyCurrency,
      r.counterpartyAmount,
      r.rateNumerator,
      r.rateDenominator,
    ]
      .map(quote)
      .join(';'),
  );
  return '\uFEFF' + [columns.join(';'), ...lines].join('\r\n') + '\r\n';
}
