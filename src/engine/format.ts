// Plain-English formatting shared by engine labels, warnings and explanations (English only,
// no Intl, so output is identical on every device and in tests).
import { dayOfWeek, diffDays } from './dates';
import type { EngineCourse, ISODate } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Oct 30" */
export function formatMonthDay(date: ISODate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** "Wed" */
export function formatWeekday(date: ISODate): string {
  return WEEKDAYS[dayOfWeek(date)];
}

/** "Wed, Oct 30" */
export function formatDayDate(date: ISODate): string {
  return `${formatWeekday(date)}, ${formatMonthDay(date)}`;
}

/** "Wed", "Wed–Fri" within a week, else "Oct 28 – Nov 6". */
export function formatDayRange(start: ISODate, end: ISODate): string {
  if (start === end) return formatWeekday(start);
  if (diffDays(start, end) <= 6) return `${formatWeekday(start)}–${formatWeekday(end)}`;
  return `${formatMonthDay(start)} – ${formatMonthDay(end)}`;
}

/** "45 min", "1h 30m", "2h" */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "14h", "12.5h" (nearest half hour) */
export function formatHours(minutes: number): string {
  const halfHours = Math.round(Math.max(0, minutes) / 30);
  return `${halfHours / 2}h`;
}

/** "25%", "12.5%", "8.3%" */
export function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** Course code, else title, else a neutral fallback. */
export function courseLabel(course: Pick<EngineCourse, 'code' | 'title'> | undefined): string {
  const code = course?.code?.trim();
  if (code) return code;
  const title = course?.title?.trim();
  return title ? title : 'your course';
}

/** "1 reading", "2 readings" */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** Rounds to the nearest multiple of 5 (half up). */
export function roundTo5(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
