import { expect, test } from 'vitest';
import {
  dateOnly,
  occurrenceDate,
  todayInTimezone,
  utcTimestamp,
} from '@/shared/calendar/calendar';
test('Календарь восстанавливает исходный anchor после короткого месяца', () => {
  expect(occurrenceDate('2027-01-31', 1, 'month')).toBe('2027-02-28');
  expect(occurrenceDate('2027-01-31', 2, 'month')).toBe('2027-03-31');
  expect(occurrenceDate('2028-02-29', 1, 'year')).toBe('2029-02-28');
  expect(occurrenceDate('2028-02-29', 4, 'year')).toBe('2032-02-29');
  expect(occurrenceDate('2027-01-31', 2, 'month', 2)).toBe('2027-05-31');
});
test('DATE валидируется без сдвига часового пояса', () => {
  expect(dateOnly('2028-02-29')).toBe('2028-02-29');
  for (const value of [
    '2027-02-29',
    '2027-13-01',
    '2027-1-1',
    '2027-01-01T00:00:00Z',
  ])
    expect(() => dateOnly(value)).toThrow();
  expect(() => occurrenceDate('2027-01-01', 1, 'month', 0)).toThrow();
});
test('UTC timestamp и локальное сегодня различаются на границе суток', () => {
  const instant = new Date('2026-10-31T23:30:00Z');
  expect(todayInTimezone('Europe/Moscow', instant)).toBe('2026-11-01');
  expect(todayInTimezone('America/New_York', instant)).toBe('2026-10-31');
  expect(utcTimestamp(instant)).toBe('2026-10-31T23:30:00.000Z');
  expect(() => todayInTimezone('Invalid/Zone', instant)).toThrow();
});
