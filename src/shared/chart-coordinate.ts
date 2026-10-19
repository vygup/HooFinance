import Decimal from 'decimal.js';
import { decimalPrecision } from './precision';
/** Server-only calculation use: convert a bounded dimensionless ratio, never a monetary value. */
export function chartCoordinate(amount: string, total: string) {
  const D = Decimal.clone({
    precision: decimalPrecision([amount, total], 'division'),
  });
  return new D(total).isZero() ? 0 : new D(amount).div(total).toNumber();
}
