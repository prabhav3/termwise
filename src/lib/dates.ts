// Calendar helpers for the student's local dates (docs/ARCHITECTURE.md rule 5).
// Pure: Intl only, no React Native, so it runs unchanged in vitest.
//
// A student's dates are `YYYY-MM-DD` strings in profiles.timezone. Arithmetic on them is done on
// UTC midnights so DST never shifts a day; only "what is today" and "when is 07:30 there" need
// the time zone.

export type ISODate = string;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ---- time zones ---------------------------------------------------------------

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The device's IANA time zone, or UTC when the runtime cannot tell. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

function resolveTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    // Some ICU builds report midnight as 24 even with h23.
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** The student's "today" in their time zone. Never slice an ISO timestamp for this. */
export function todayISO(timeZone: string | null | undefined, now: Date = new Date()): ISODate {
  const { year, month, day } = wallClock(now, resolveTimeZone(timeZone));
  return formatISO(year, month, day);
}

/** Offset of `timeZone` from UTC at `instantMs`, in ms (positive east of Greenwich). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  const w = wallClock(new Date(wholeSeconds), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - wholeSeconds;
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `time` — e.g. "07:30 on
 * 2026-11-03 in America/New_York". A time skipped by a DST jump resolves to the shifted-forward
 * instant (02:30 -> 03:30); a repeated time resolves to one of its two occurrences.
 */
export function zonedDateTimeToDate(date: ISODate, time: string, timeZone: string | null | undefined): Date {
  const zone = resolveTimeZone(timeZone);
  const { year, month, day } = parseISODate(date);
  const { hours, minutes } = parseTime(time);
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const offsetA = zoneOffsetMs(wallAsUtc, zone);
  const candidateA = wallAsUtc - offsetA;
  const offsetB = zoneOffsetMs(candidateA, zone);
  if (offsetA === offsetB) return new Date(candidateA);
  const candidateB = wallAsUtc - offsetB;
  if (zoneOffsetMs(candidateB, zone) === offsetB) return new Date(candidateB);
  return new Date(Math.max(candidateA, candidateB));
}

// ---- calendar arithmetic ---------------------------------------------------------

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatISO(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isISODateString(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return utc.getUTCFullYear() === Number(y) && utc.getUTCMonth() === Number(m) - 1 && utc.getUTCDate() === Number(d);
}

export function parseISODate(date: ISODate): { year: number; month: number; day: number } {
  if (!isISODateString(date)) throw new RangeError(`Not a calendar date: "${date}"`);
  const [y, m, d] = date.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

function utcMidnight(date: ISODate): number {
  const { year, month, day } = parseISODate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): ISODate {
  const d = new Date(ms);
  return formatISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDaysISO(date: ISODate, days: number): ISODate {
  return fromUtcMs(utcMidnight(date) + Math.trunc(days) * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDaysISO(from: ISODate, to: ISODate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayISO(date: ISODate): number {
  return new Date(utcMidnight(date)).getUTCDay();
}

/** Monday of the week containing `date`. */
export function startOfWeekISO(date: ISODate): ISODate {
  return addDaysISO(date, -((weekdayISO(date) + 6) % 7));
}

// ---- parsing & formatting ----------------------------------------------------------

export function parseTime(time: string): { hours: number; minutes: number } {
  const match = TIME.exec(time.trim());
  if (!match) throw new RangeError(`Not a time of day: "${time}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new RangeError(`Not a time of day: "${time}"`);
  return { hours, minutes };
}

/** "7:30" / "07:30:00" -> "07:30". */
export function normalizeTime(time: string): string {
  const { hours, minutes } = parseTime(time);
  return `${pad(hours)}:${pad(minutes)}`;
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function displayFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = displayFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    displayFormatters.set(key, formatter);
  }
  return formatter;
}

/** "Tue, Oct 28" */
export function formatDayDate(date: ISODate, locale = 'en-US'): string {
  return displayFormatter(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(utcMidnight(date));
}

/** "Tuesday, October 28" */
export function formatLongDate(date: ISODate, locale = 'en-US'): string {
  return displayFormatter(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(utcMidnight(date));
}

/** "Oct 28" */
export function formatShortDate(date: ISODate, locale = 'en-US'): string {
  return displayFormatter(locale, { month: 'short', day: 'numeric' }).format(utcMidnight(date));
}

/** "07:30" -> "7:30 AM" (locale-dependent). */
export function formatTimeOfDay(time: string, locale = 'en-US'): string {
  const { hours, minutes } = parseTime(time);
  return displayFormatter(locale, { hour: 'numeric', minute: '2-digit' }).format(Date.UTC(1970, 0, 1, hours, minutes));
}

/** "Today", "Tomorrow", "Yesterday", "in 3 days", "3 days ago". */
export function relativeDayLabel(date: ISODate, today: ISODate): string {
  const days = diffDaysISO(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export interface DueInfo {
  /** "Tue, Oct 28" */
  date: string;
  /** "in 3 days" / "Today" / "2 days ago" */
  relative: string;
  /** One line for rows: "Today", "Tomorrow", "Tue, Oct 28 · in 3 days", "Tue, Oct 28". */
  label: string;
  daysUntil: number;
  overdue: boolean;
}

const RELATIVE_HORIZON_DAYS = 13;

export function describeDue(due: ISODate, today: ISODate, locale = 'en-US'): DueInfo {
  const daysUntil = diffDaysISO(today, due);
  const date = formatDayDate(due, locale);
  const relative = relativeDayLabel(due, today);
  let label: string;
  if (Math.abs(daysUntil) <= 1) label = relative;
  else if (Math.abs(daysUntil) <= RELATIVE_HORIZON_DAYS) label = `${date} · ${relative}`;
  else label = date;
  return { date, relative, label, daysUntil, overdue: daysUntil < 0 };
}

/** "45 min", "2h", "1h 30m". */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// ---- device-local Date bridging (pickers) ---------------------------------------------

/** Calendar date shown on a device-local Date (as returned by date pickers). */
export function localDateToISO(date: Date): ISODate {
  return formatISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Device-local Date at noon on `date` (noon keeps DST transitions from changing the day). */
export function isoToLocalDate(date: ISODate): Date {
  const { year, month, day } = parseISODate(date);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function localDateToTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function timeToLocalDate(time: string, base: Date = new Date()): Date {
  const { hours, minutes } = parseTime(time);
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}
