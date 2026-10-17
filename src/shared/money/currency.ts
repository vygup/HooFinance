const currencies = new Set(Intl.supportedValuesOf('currency'));
export function currencyScale(currency: string) {
  if (!currencies.has(currency)) throw new Error('UNSUPPORTED_CURRENCY');
  const scale = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  if (scale === undefined) throw new Error('UNSUPPORTED_CURRENCY_SCALE');
  return scale;
}
export function currencyCatalog() {
  return [...currencies].map((code) => ({ code, scale: currencyScale(code) }));
}
