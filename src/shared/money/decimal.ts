import Decimal from 'decimal.js';
import { currencyScale } from './currency';
import { decimalPrecision } from '@/shared/precision';
const grammar = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
function finite(value: string) {
  if (!grammar.test(value)) throw new Error('INVALID_DECIMAL');
  return value;
}
export function validateAmount(value: string, currency: string) {
  finite(value);
  const scale = currencyScale(currency);
  if ((value.split('.')[1]?.length ?? 0) > scale)
    throw new Error('INVALID_SCALE');
  return new Decimal(value).toFixed(scale);
}
function decimal(
  values: readonly string[],
  mode: 'sum' | 'product' | 'division' = 'sum',
) {
  values.forEach(finite);
  return Decimal.clone({
    precision: decimalPrecision(values, mode),
    rounding: Decimal.ROUND_HALF_UP,
  });
}
export function addMoney(values: readonly string[], currency: string) {
  values.forEach((value) => validateAmount(value, currency));
  const D = decimal(values);
  return values
    .reduce((total, value) => total.plus(value), new D('0'))
    .toFixed(currencyScale(currency));
}
export function subtractMoney(left: string, right: string, currency: string) {
  validateAmount(left, currency);
  validateAmount(right, currency);
  const D = decimal([left, right]);
  return new D(left).minus(right).toFixed(currencyScale(currency));
}
export function multiplyMoney(left: string, right: string, currency: string) {
  const D = decimal([left, right], 'product');
  return new D(left)
    .times(right)
    .toFixed(currencyScale(currency), Decimal.ROUND_HALF_UP);
}
export function roundMoney(value: string, currency: string) {
  const D = decimal([value]);
  return new D(value).toFixed(currencyScale(currency), Decimal.ROUND_HALF_UP);
}
export function divideMoney(
  value: string,
  divisor: string,
  currency: string,
  rounding: 'half-up' | 'ceil' = 'half-up',
) {
  const D = decimal([value, divisor], 'division');
  if (new D(divisor).isZero()) throw new Error('DIVISION_BY_ZERO');
  if (
    rounding === 'ceil' &&
    (new D(value).isNegative() || new D(divisor).isNegative())
  )
    throw new Error('INVALID_CEIL_INPUT');
  return new D(value)
    .div(divisor)
    .toFixed(
      currencyScale(currency),
      rounding === 'ceil' ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP,
    );
}
