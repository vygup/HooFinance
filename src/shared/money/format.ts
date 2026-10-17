import { currencyScale } from './currency';
import { validateAmount } from './decimal';
/** Modern Intl accepts exact decimal strings; TS's older signature omits strings. */
export function formatMoney(value: string, currency: string, locale = 'ru-RU') {
  const scale = currencyScale(currency);
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const format = formatter.format as unknown as (value: string) => string;
  return `${format(validateAmount(value, currency))} ${currency}`;
}
