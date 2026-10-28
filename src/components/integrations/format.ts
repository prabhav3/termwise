// Student-facing labels for connections, sync results and LMS values.
import { parseLmsStamp } from '@/data/integrations';
import { formatDayDate, formatTimeOfDay, todayISO } from '@/lib/dates';
import type { CalendarProvider, ConnectionStatus, DiscrepancyKind, LmsProvider, Timestamp } from '@/types/db';

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const CALENDAR_PROVIDER_NAMES: Record<CalendarProvider, string> = {
  apple: 'Apple Calendar',
  google: 'Google Calendar',
  microsoft: 'Outlook',
};

export const LMS_PROVIDER_NAMES: Record<LmsProvider, string> = {
  canvas: 'Canvas',
  blackboard: 'Blackboard',
  moodle: 'Moodle',
  ics: 'LMS feed',
};

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function wallTime(instant: Date, timeZone: string): { date: string; time: string } {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', {
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    timeFormatters.set(timeZone, formatter);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const hour = String(Number(parts.hour ?? '0') % 24).padStart(2, '0');
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute ?? '00'}` };
}

/** "Synced today at 3:42 PM" / "Synced Tue, Oct 27 at 9:05 AM" / "Not synced yet". */
export function syncedLabel(at: Timestamp | null | undefined, timeZone: string | null | undefined): string {
  if (!at) return 'Not synced yet';
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return 'Not synced yet';
  const zone = timeZone ?? 'UTC';
  const { date, time } = wallTime(instant, zone);
  const day = date === todayISO(zone) ? 'today' : formatDayDate(date);
  return `Synced ${day} at ${formatTimeOfDay(time)}`;
}

/** "Fri, Nov 7 · 11:59 PM" for an LMS stamp; other values (points, weights) as they are. */
export function formatLmsValue(value: string | null): string {
  if (value === null || value.trim() === '') return 'Not listed';
  const stamp = parseLmsStamp(value);
  if (!stamp) return value;
  return stamp.time ? `${formatDayDate(stamp.date)} · ${formatTimeOfDay(stamp.time)}` : formatDayDate(stamp.date);
}

export const DISCREPANCY_KIND_LABELS: Record<DiscrepancyKind, string> = {
  date_mismatch: 'Different due dates',
  locks_before_due: 'Locks before it is due',
  missing_in_lms: 'Not in the LMS yet',
  missing_in_syllabus: 'Not in the syllabus',
  weight_mismatch: 'Different grade weights',
  points_mismatch: 'Different point totals',
};

/** Column labels for the two-sided comparison, e.g. "Syllabus" vs "Canvas locks". */
export function discrepancyColumns(kind: DiscrepancyKind, lmsName: string): { syllabus: string; lms: string } {
  switch (kind) {
    case 'locks_before_due':
      return { syllabus: 'Syllabus due', lms: `${lmsName} locks` };
    case 'weight_mismatch':
      return { syllabus: 'Syllabus weight', lms: `${lmsName} weight` };
    case 'points_mismatch':
      return { syllabus: 'Syllabus points', lms: `${lmsName} points` };
    default:
      return { syllabus: 'Syllabus', lms: lmsName };
  }
}

export type StatusTone = 'green' | 'orange' | 'red' | 'ink';

export interface ConnectionState {
  label: string;
  tone: StatusTone;
}

/** Badge text + tone; the text always carries the meaning (never color alone). */
export function connectionState(status: ConnectionStatus | null, lastError?: string | null): ConnectionState {
  if (status === null) return { label: 'Not connected', tone: 'ink' };
  if (status === 'needs_reauth') return { label: 'Reconnect', tone: 'red' };
  if (status === 'disconnected') return { label: 'Disconnected', tone: 'ink' };
  if (lastError) return { label: 'Needs a look', tone: 'orange' };
  return { label: 'Connected', tone: 'green' };
}

export interface SyncCounts {
  created: number;
  updated: number;
  deleted: number;
  /** Date changes made in the external calendar, now waiting for review. */
  externalChanges: number;
  errors: readonly string[];
}

/** Toast copy for a calendar sync: "Added 12 · updated 3. 2 date changes to review." */
export function syncSummary(counts: SyncCounts): { tone: 'success' | 'warning'; title: string; message: string } {
  const parts: string[] = [];
  if (counts.created > 0) parts.push(`added ${counts.created}`);
  if (counts.updated > 0) parts.push(`updated ${counts.updated}`);
  if (counts.deleted > 0) parts.push(`removed ${counts.deleted}`);
  let message = parts.length > 0 ? `${parts.join(' · ')}.` : 'Everything was already up to date.';
  message = message.charAt(0).toUpperCase() + message.slice(1);
  if (counts.externalChanges > 0) {
    message += ` ${plural(counts.externalChanges, 'date change')} from your calendar to review on the item.`;
  }
  if (counts.errors.length > 0) {
    return { tone: 'warning', title: 'Synced with problems', message: `${message} ${counts.errors[0]}` };
  }
  return { tone: 'success', title: 'Calendar synced', message };
}
