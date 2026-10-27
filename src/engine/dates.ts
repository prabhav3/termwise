// Calendar-date arithmetic on local `YYYY-MM-DD` strings. Pure integer math (no Date objects),
// so results never depend on the device timezone or DST.
import type { ISODate } from './types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Days since 1970-01-01 (Hinnant's days_from_civil). Throws on malformed input. */
export function toDayNumber(date: ISODate): number {
  if (!isISODate(date)) throw new RangeError(`Invalid ISO date: ${String(date)}`);
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const year = Number(date.slice(0, 4)) - (month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Inverse of `toDayNumber` (Hinnant's civil_from_days). */
export function fromDayNumber(dayNumber: number): ISODate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + Math.trunc(days));
}

/** Whole days from `from` to `to` (to - from). */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: ISODate): number {
  // 1970-01-01 was a Thursday (4).
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/** Inclusive; [] when end < start. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const first = toDayNumber(start);
  const last = toDayNumber(end);
  const days: ISODate[] = [];
  for (let n = first; n <= last; n++) days.push(fromDayNumber(n));
  return days;
}

export function compareDates(a: ISODate, b: ISODate): number {
  // Valid ISO dates sort lexicographically.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let result: ISODate | null = null;
  for (const date of dates) {
    if (date != null && (result === null || date < result)) result = date;
  }
  return result;
}

export function maxDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let result: ISODate | null = null;
  for (const date of dates) {
    if (date != null && (result === null || date > result)) result = date;
  }
  return result;
}
