import { describe, expect, it } from 'vitest';
import { fromDayNumber, toDayNumber } from '../dates';
import { formatDayDate, formatDayRange, formatHours, formatMinutes, formatPercent } from '../format';
import { addDays, compareDates, dayOfWeek, diffDays, eachDay, isISODate, maxDate, minDate, startOfWeek } from '../index';

describe('date arithmetic', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-10-27', 5)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-03', -7)).toBe('2026-12-27');
    expect(addDays('2026-10-27', 0)).toBe('2026-10-27');
  });

  it('diffs whole days in both directions', () => {
    expect(diffDays('2026-10-27', '2026-11-03')).toBe(7);
    expect(diffDays('2026-11-03', '2026-10-27')).toBe(-7);
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('round-trips day numbers over decades', () => {
    for (let n = -20000; n <= 40000; n += 37) {
      const date = fromDayNumber(n);
      expect(isISODate(date)).toBe(true);
      expect(toDayNumber(date)).toBe(n);
    }
    expect(toDayNumber('1970-01-01')).toBe(0);
  });

  it('knows the weekday (0 = Sunday)', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4);
    expect(dayOfWeek('2000-01-01')).toBe(6);
    expect(dayOfWeek('2024-02-29')).toBe(4);
    expect(dayOfWeek('2026-10-27')).toBe(2);
    expect(dayOfWeek('1969-12-31')).toBe(3);
  });

  it('finds the Monday of a week', () => {
    expect(startOfWeek('2026-10-27')).toBe('2026-10-26');
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the week before
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('lists every day inclusively, or none when reversed', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(eachDay('2026-10-30', '2026-10-30')).toEqual(['2026-10-30']);
    expect(eachDay('2026-11-02', '2026-10-30')).toEqual([]);
  });

  it('compares and picks min/max ignoring nulls', () => {
    expect(compareDates('2026-10-27', '2026-10-28')).toBeLessThan(0);
    expect(compareDates('2026-10-28', '2026-10-27')).toBeGreaterThan(0);
    expect(compareDates('2026-10-27', '2026-10-27')).toBe(0);
    expect(minDate(null, '2026-11-02', undefined, '2026-10-30')).toBe('2026-10-30');
    expect(maxDate(null, '2026-11-02', undefined, '2026-10-30')).toBe('2026-11-02');
    expect(minDate(null, undefined)).toBeNull();
    expect(maxDate()).toBeNull();
  });

  it('validates ISO dates strictly', () => {
    expect(isISODate('2026-10-27')).toBe(true);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate('2100-02-29')).toBe(false);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-1-01')).toBe(false);
    expect(isISODate('2026-10-27T00:00:00Z')).toBe(false);
    expect(isISODate(20261027)).toBe(false);
    expect(isISODate(null)).toBe(false);
  });

  it('rejects malformed dates in arithmetic instead of guessing', () => {
    expect(() => addDays('10/27/2026', 1)).toThrow(RangeError);
  });
});

describe('formatting helpers', () => {
  it('formats dates, ranges, durations and percents in plain English', () => {
    expect(formatDayDate('2026-10-27')).toBe('Tue, Oct 27');
    expect(formatDayRange('2026-10-28', '2026-10-30')).toBe('Wed–Fri');
    expect(formatDayRange('2026-10-28', '2026-10-28')).toBe('Wed');
    expect(formatDayRange('2026-10-28', '2026-11-06')).toBe('Oct 28 – Nov 6');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(150)).toBe('2h 30m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatHours(840)).toBe('14h');
    expect(formatHours(750)).toBe('12.5h');
    expect(formatPercent(25)).toBe('25%');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatPercent(100 / 12)).toBe('8.3%');
  });
});
