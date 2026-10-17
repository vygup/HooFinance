import { expect, test } from 'vitest';
import { switchingInput } from '@/modules/workspaces/application/switching-input';
import {
  switchingTarget,
  calendarContext,
  shouldWarnBeforeLeaving,
} from '@/modules/workspaces/domain/switching';
const id = '00000000-0000-4000-8000-000000000001';
test('switch removes previous object, period, currency and arbitrary URL', () => {
  expect(
    switchingTarget(id, false, '/w/old/operations?text=private&accountId=old'),
  ).toBe(`/w/${id}/operations`);
  expect(
    switchingInput.safeParse({ workspaceId: id, section: 'operations' })
      .success,
  ).toBe(true);
  expect(switchingTarget(id, false, '/w/old/budget?month=2020-01')).toBe(
    `/w/${id}/budget`,
  );
  expect(switchingTarget(id, false, '/w/old/goals/secret')).toBe(
    `/w/${id}/accounts`,
  );
  expect(switchingTarget(id, true, '/w/old/accounts')).toBe(
    `/families?history=${id}`,
  );
  expect(
    switchingInput.safeParse({ workspaceId: '../foreign', section: 'accounts' })
      .success,
  ).toBe(false);
});
test('family calendar is shared at month boundary; personal retains own timezone', () => {
  const instant = new Date('2026-10-31T22:30:00Z');
  for (const personal of ['America/Los_Angeles', 'Asia/Tokyo'])
    expect(
      calendarContext('family', 'Europe/Moscow', personal, instant),
    ).toEqual({
      timezone: 'Europe/Moscow',
      today: '2026-11-01',
      month: '2026-11',
    });
  expect(
    calendarContext('personal', null, 'America/Los_Angeles', instant).month,
  ).toBe('2026-10');
});
test('dirty navigation requires explicit consent, same target does not', () => {
  expect(shouldWarnBeforeLeaving(true, '/a', '/b')).toBe(true);
  expect(shouldWarnBeforeLeaving(false, '/a', '/b')).toBe(false);
  expect(shouldWarnBeforeLeaving(true, '/a', '/a')).toBe(false);
});
