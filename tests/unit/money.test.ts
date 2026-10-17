import { expect, test } from 'vitest';
import {
  addMoney,
  subtractMoney,
  roundMoney,
  divideMoney,
  validateAmount,
  multiplyMoney,
} from '@/shared/money/decimal';
test('Строковые суммы точны, включая величины больше number и 80 разрядов', () => {
  expect(addMoney(['0.1', '0.2'], 'RUB')).toBe('0.30');
  const huge = '9'.repeat(100);
  expect(addMoney([`${huge}.99`, '0.01'], 'RUB')).toBe(
    `1${'0'.repeat(100)}.00`,
  );
  expect(subtractMoney('1', '1.01', 'RUB')).toBe('-0.01');
});
test('Ввод не округляется скрыто; special values и exponent запрещены', () => {
  for (const input of ['NaN', 'Infinity', '1e3', '1.005', '', ' 1', '1,25'])
    expect(() => validateAmount(input, 'RUB')).toThrow();
  expect(() => validateAmount('1.1', 'JPY')).toThrow();
  expect(() => validateAmount('1', 'INVALID')).toThrow();
  expect(validateAmount('-1.25', 'RUB')).toBe('-1.25');
});
test('Явные half-up и ceil, масштаб валюты', () => {
  expect(roundMoney('1.005', 'RUB')).toBe('1.01');
  expect(roundMoney('-1.005', 'RUB')).toBe('-1.01');
  expect(divideMoney('100', '3', 'RUB', 'ceil')).toBe('33.34');
  expect(roundMoney('1.2345', 'KWD')).toBe('1.235');
  expect(() => divideMoney('1', '0', 'RUB')).toThrow();
});

test('Умножение сохраняет все разряды; точность суммы учитывает количество слагаемых', () => {
  const huge = '9'.repeat(100);
  expect(multiplyMoney(huge, huge, 'RUB')).toBe(
    `${'9'.repeat(99)}8${'0'.repeat(99)}1.00`,
  );
  expect(
    addMoney(
      Array.from({ length: 1000 }, () => '0.01'),
      'RUB',
    ),
  ).toBe('10.00');
});
