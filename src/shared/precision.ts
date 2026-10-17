/** Только количество знаков/слагаемых: денежные значения не преобразуются в number. */
export function decimalPrecision(
  values: readonly string[],
  mode: 'sum' | 'product' | 'division' = 'sum',
) {
  if (mode !== 'sum')
    return Math.max(
      80,
      values.reduce(
        (digits, value) => digits + value.replace(/[^0-9]/g, '').length,
        0,
      ) + 40,
    );
  const max = values.reduce(
    (counts, value) => {
      const [integer = '0', fraction = ''] = value.replace('-', '').split('.');
      return {
        integer: Math.max(counts.integer, integer.length),
        fraction: Math.max(counts.fraction, fraction.length),
      };
    },
    { integer: 1, fraction: 0 },
  );
  return Math.max(
    80,
    max.integer + max.fraction + Math.ceil(Math.log10(values.length + 1)) + 40,
  );
}
