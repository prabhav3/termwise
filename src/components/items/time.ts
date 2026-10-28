// Instants (timestamptz: LMS lock dates, last sync) shown on the student's own calendar.
import { deviceTimeZone, formatDayDate, formatTimeOfDay, isValidTimeZone, relativeDayLabel, todayISO, type ISODate } from '@/lib/dates';

export interface LocalStamp {
  date: ISODate;
  /** `HH:MM` on a 24-hour clock. */
  time: string;
  /** "Tue, Nov 3, 11:59 PM" */
  label: string;
}

function zoneOrDevice(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
}

/** The wall-clock date and time of an instant in `timeZone`; null for an unreadable value. */
export function localStamp(timestamp: string | null | undefined, timeZone: string | null | undefined): LocalStamp | null {
  if (!timestamp) return null;
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = zoneOrDevice(timeZone);
  const date = todayISO(zone, instant);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(instant);
  const hour = (Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24).toString().padStart(2, '0');
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const time = `${hour}:${minute}`;
  return { date, time, label: `${formatDayDate(date)}, ${formatTimeOfDay(time)}` };
}

/** "Synced today", "Synced 3 days ago", "Never synced". */
export function syncedLabel(timestamp: string | null | undefined, timeZone: string | null | undefined, today: ISODate): string {
  const stamp = localStamp(timestamp, timeZone);
  if (!stamp) return 'Not synced yet';
  return `Synced ${relativeDayLabel(stamp.date, today).toLowerCase()}`;
}
