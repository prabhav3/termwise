import { describe, expect, it } from 'vitest';

import {
  addDaysISO,
  describeDue,
  diffDaysISO,
  formatDayDate,
  formatMinutes,
  formatTimeOfDay,
  isISODateString,
  isoToLocalDate,
  localDateToISO,
  normalizeTime,
  relativeDayLabel,
  startOfWeekISO,
  todayISO,
  weekdayISO,
  zonedDateTimeToDate,
} from './dates';

describe('todayISO', () => {
  // 2026-10-28T03:30:00Z is still Oct 27 in New York but already Oct 28 in Tokyo.
  const instant = new Date('2026-10-28T03:30:00Z');

  it('uses the wall clock of the given time zone, not UTC', () => {
    expect(todayISO('America/New_York', instant)).toBe('2026-10-27');
    expect(todayISO('Asia/Tokyo', instant)).toBe('2026-10-28');
    expect(todayISO('UTC', instant)).toBe('2026-10-28');
  });

  it('handles midnight exactly', () => {
    expect(todayISO('America/Los_Angeles', new Date('2026-10-27T07:00:00Z'))).toBe('2026-10-27');
    expect(todayISO('America/Los_Angeles', new Date('2026-10-27T06:59:59Z'))).toBe('2026-10-26');
  });

  it('falls back to the device zone for an invalid zone instead of throwing', () => {
    expect(isISODateString(todayISO('Not/AZone', instant))).toBe(true);
    expect(isISODateString(todayISO(null, instant))).toBe(true);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across month, year and DST boundaries', () => {
    expect(addDaysISO('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    // US DST ends 2026-11-01; whole-day steps never drift.
    expect(addDaysISO('2026-10-31', 2)).toBe('2026-11-02');
  });

  it('diffs whole days', () => {
    expect(diffDaysISO('2026-10-27', '2026-10-30')).toBe(3);
    expect(diffDaysISO('2026-10-30', '2026-10-27')).toBe(-3);
    expect(diffDaysISO('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('knows weekdays and Monday week starts', () => {
    expect(weekdayISO('2026-10-27')).toBe(2); // Tuesday
    expect(startOfWeekISO('2026-10-27')).toBe('2026-10-26');
    expect(startOfWeekISO('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week before
    expect(startOfWeekISO('2026-10-26')).toBe('2026-10-26');
  });

  it('validates real calendar dates only', () => {
    expect(isISODateString('2026-02-29')).toBe(false);
    expect(isISODateString('2028-02-29')).toBe(true);
    expect(isISODateString('2026-1-5')).toBe(false);
    expect(isISODateString(20261027)).toBe(false);
  });
});

describe('due date formatting', () => {
  it('formats short day dates', () => {
    expect(formatDayDate('2026-10-28')).toBe('Wed, Oct 28');
    expect(formatDayDate('2026-11-03')).toBe('Tue, Nov 3');
  });

  it('labels relative days', () => {
    const today = '2026-10-27';
    expect(relativeDayLabel('2026-10-27', today)).toBe('Today');
    expect(relativeDayLabel('2026-10-28', today)).toBe('Tomorrow');
    expect(relativeDayLabel('2026-10-26', today)).toBe('Yesterday');
    expect(relativeDayLabel('2026-10-30', today)).toBe('in 3 days');
    expect(relativeDayLabel('2026-10-24', today)).toBe('3 days ago');
  });

  it('describes due dates for rows', () => {
    const today = '2026-10-27';
    expect(describeDue('2026-10-27', today).label).toBe('Today');
    expect(describeDue('2026-10-30', today)).toMatchObject({
      date: 'Fri, Oct 30',
      relative: 'in 3 days',
      label: 'Fri, Oct 30 · in 3 days',
      daysUntil: 3,
      overdue: false,
    });
    expect(describeDue('2026-10-25', today)).toMatchObject({ overdue: true, relative: '2 days ago' });
    expect(describeDue('2026-12-01', today).label).toBe('Tue, Dec 1');
  });

  it('formats times and durations', () => {
    // ICU separates the day period with a (narrow) no-break space, which \s matches.
    expect(formatTimeOfDay('07:30')).toMatch(/^7:30\sAM$/);
    expect(formatTimeOfDay('19:05:00')).toMatch(/^7:05\sPM$/);
    expect(normalizeTime('7:30')).toBe('07:30');
    expect(normalizeTime('07:30:00')).toBe('07:30');
    expect(() => normalizeTime('25:00')).toThrow(RangeError);
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(95)).toBe('1h 35m');
  });
});

describe('zonedDateTimeToDate', () => {
  it('converts a wall-clock time in the student zone to an instant', () => {
    // EDT (UTC-4) before Nov 1, EST (UTC-5) after.
    expect(zonedDateTimeToDate('2026-10-28', '07:30', 'America/New_York').toISOString()).toBe('2026-10-28T11:30:00.000Z');
    expect(zonedDateTimeToDate('2026-11-03', '07:30', 'America/New_York').toISOString()).toBe('2026-11-03T12:30:00.000Z');
    expect(zonedDateTimeToDate('2026-10-28', '07:30:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-28T02:00:00.000Z');
  });

  it('shifts times skipped by spring-forward to the next valid instant', () => {
    // 2026-03-08 02:30 does not exist in New York; 03:30 EDT = 07:30Z.
    expect(zonedDateTimeToDate('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('picker bridging', () => {
  it('round-trips device-local dates', () => {
    expect(localDateToISO(isoToLocalDate('2026-11-01'))).toBe('2026-11-01');
    expect(localDateToISO(isoToLocalDate('2027-01-01'))).toBe('2027-01-01');
  });
});
