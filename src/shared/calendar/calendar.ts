export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    throw new Error('INVALID_DATE');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error('INVALID_DATE');
  return value;
}
export function occurrenceDate(
  anchor: string,
  index: number,
  unit: 'day' | 'week' | 'month' | 'year',
  repeatEvery = 1,
): string {
  dateOnly(anchor);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Number.isSafeInteger(repeatEvery) ||
    repeatEvery <= 0 ||
    !Number.isSafeInteger(index * repeatEvery)
  )
    throw new Error('INVALID_RECURRENCE');
  const date = new Date(`${anchor}T00:00:00Z`);
  const day = date.getUTCDate();
  const offset = index * repeatEvery;
  if (unit === 'day' || unit === 'week')
    date.setUTCDate(day + offset * (unit === 'week' ? 7 : 1));
  else {
    date.setUTCDate(1);
    if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + offset);
    else date.setUTCFullYear(date.getUTCFullYear() + offset);
    const end = new Date(date);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_DATE_RANGE');
  return dateOnly(date.toISOString().slice(0, 10));
}
export function todayInTimezone(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return dateOnly(`${field('year')}-${field('month')}-${field('day')}`);
}
export function utcTimestamp(instant = new Date()) {
  return instant.toISOString();
}
export function formatFinancialDate(value: string, locale = 'ru-RU') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }).format(new Date(`${dateOnly(value)}T00:00:00Z`));
}

/** Monthly indices are calendar counts, never monetary values. */
export function remainingMonthlySchedule(
  anchor: string,
  today: string,
  deadline: string | null,
) {
  dateOnly(anchor);
  dateOnly(today);
  if (deadline !== null) dateOnly(deadline);
  const month = (d: string) =>
    Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  let first = Math.max(0, month(today) - month(anchor));
  if (occurrenceDate(anchor, first, 'month') < today) first++;
  let last = deadline === null ? -1 : month(deadline) - month(anchor);
  if (last >= 0 && occurrenceDate(anchor, last, 'month') > deadline!) last--;
  return {
    nextDate: occurrenceDate(anchor, first, 'month'),
    count: String(Math.max(0, last - first + 1)),
    first,
  };
}
export function monthlyForecastDate(
  anchor: string,
  first: number,
  contributionCount: string,
) {
  if (!/^[1-9]\d*$/.test(contributionCount)) throw Error('INVALID_COUNT');
  // Bound only the representable calendar, not money or the contribution plan.
  if (BigInt(contributionCount) > 120000n) return null;
  try {
    return occurrenceDate(
      anchor,
      first + Number(contributionCount) - 1,
      'month',
    );
  } catch {
    return null;
  }
}

/** Calendar-only stepping; monetary values never enter this function. */
export function recurrenceDates(
  anchor: string,
  every: number,
  unit: 'day' | 'week' | 'month' | 'year',
  from: string,
  until: string,
) {
  dateOnly(from);
  dateOnly(until);
  const result: string[] = [];
  if (until < anchor || until < from) return result;
  let low = 0,
    high = 1;
  const at = (i: number) => {
    try {
      return occurrenceDate(anchor, i, unit, every);
    } catch {
      return '9999-12-32';
    }
  };
  while (at(high) < from) high *= 2;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (at(mid) < from) low = mid + 1;
    else high = mid;
  }
  for (let i = low; ; i++) {
    const date = at(i);
    if (date > until) break;
    result.push(date);
  }
  return result;
}
export function followingDate(date: string) {
  return occurrenceDate(date, 1, 'day');
}

/** Inclusive calendar boundaries; financial DATE values never shift with timezone. */
export function reportPeriod(
  period: 'current' | 'previous' | 'year',
  today: string,
) {
  dateOnly(today);
  const first = `${today.slice(0, 7)}-01`;
  const previous = new Date(`${first}T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const from =
    period === 'year'
      ? `${today.slice(0, 4)}-01-01`
      : period === 'previous'
        ? previous.toISOString().slice(0, 10)
        : first;
  const end = new Date(`${from}T00:00:00Z`);
  if (period === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, until: dateOnly(end.toISOString().slice(0, 10)) };
}
