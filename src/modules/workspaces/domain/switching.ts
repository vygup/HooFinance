import { todayInTimezone } from '@/shared/calendar/calendar';
export type SpaceOption = {
  id: string;
  name: string;
  kind: 'personal' | 'family';
};
export function calendarContext(
  kind: 'personal' | 'family',
  familyTimezone: string | null,
  personalTimezone: string,
  instant = new Date(),
) {
  const timezone = kind === 'family' ? familyTimezone : personalTimezone;
  if (!timezone) throw Error('INVALID_TIMEZONE');
  const today = todayInTimezone(timezone, instant);
  return { timezone, today, month: today.slice(0, 7) };
}
export function switchingTarget(
  id: string,
  deleted: boolean,
  pathname: string,
) {
  if (deleted) return `/families?history=${id}`;
  const section =
    /^\/w\/[^/]+\/(accounts|budget|goals|operations)$/.exec(
      pathname.split('?')[0]!,
    )?.[1] ?? 'accounts';
  return `/w/${id}/${section}`;
}
export function shouldWarnBeforeLeaving(
  dirty: boolean,
  current: string,
  target: string,
) {
  return dirty && current !== target;
}
