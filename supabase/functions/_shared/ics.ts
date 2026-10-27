// RFC 5545 iCalendar: a builder for the ics-feed subscription (text escaping, 75-octet line
// folding, all-day VALUE=DATE events with exclusive DTEND, timed events with TZID and a generated
// VTIMEZONE) and a tolerant parser for LMS feeds (unfolding, VALUE=DATE, UTC / TZID / floating
// times, CATEGORIES, Windows zone names). Runtime-agnostic.
import { isISODate, isValidTimeZone, localToUtcMs, resolveTimeZone, type ISODate, type LocalTime, tzOffsetMinutes, utcToLocal } from './calendar-model.ts';

export type IcsDateTime =
  | { kind: 'date'; date: ISODate }
  | { kind: 'zoned'; date: ISODate; time: LocalTime; tzid: string }
  | { kind: 'utc'; instant: string }
  | { kind: 'floating'; date: ISODate; time: LocalTime };

export interface IcsEventInput {
  uid: string;
  summary: string;
  start: IcsDateTime;
  /** Exclusive end. Defaults: all-day → next day; timed → same as start. */
  end?: IcsDateTime | null;
  description?: string | null;
  url?: string | null;
  location?: string | null;
  categories?: string[];
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** TRANSP:TRANSPARENT so deadlines don't block free/busy. */
  transparent?: boolean;
  /** ISO instant of the last change. */
  lastModified?: string | null;
}

export interface IcsCalendarInput {
  prodId: string;
  name?: string;
  description?: string;
  /** X-WR-TIMEZONE hint for clients. */
  timeZone?: string;
  /** ISO 8601 duration for REFRESH-INTERVAL / X-PUBLISHED-TTL, e.g. "PT6H". */
  refreshInterval?: string;
  /** DTSTAMP for every event; defaults to now. */
  dtstamp?: string;
  events: IcsEventInput[];
}

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting UTF-8 sequences (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += char;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compactDate = (date: ISODate) => date.replace(/-/g, '');
const compactTime = (time: LocalTime) => `${time.slice(0, 2)}${time.slice(3, 5)}${time.length >= 8 ? time.slice(6, 8) : '00'}`;

function compactUtc(instant: string | number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function paramValue(value: string): string {
  return /[;:,"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value;
}

function dateProperty(name: 'DTSTART' | 'DTEND', value: IcsDateTime): string {
  switch (value.kind) {
    case 'date':
      return `${name};VALUE=DATE:${compactDate(value.date)}`;
    case 'zoned':
      return `${name};TZID=${paramValue(value.tzid)}:${compactDate(value.date)}T${compactTime(value.time)}`;
    case 'utc':
      return `${name}:${compactUtc(value.instant)}`;
    case 'floating':
      return `${name}:${compactDate(value.date)}T${compactTime(value.time)}`;
  }
}

function nextDay(date: ISODate): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

interface Transition {
  atMs: number;
  from: number;
  to: number;
}

/** UTC-offset changes of `tzid` in [fromMs, toMs), found by daily sampling + bisection to the minute. */
export function findTransitions(tzid: string, fromMs: number, toMs: number): Transition[] {
  const step = 86_400_000;
  const out: Transition[] = [];
  let prevMs = fromMs;
  let prevOffset = tzOffsetMinutes(prevMs, tzid);
  for (let t = fromMs + step; t <= toMs; t += step) {
    const offset = tzOffsetMinutes(t, tzid);
    if (offset !== prevOffset) {
      let lo = prevMs;
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (tzOffsetMinutes(mid, tzid) === prevOffset) lo = mid;
        else hi = mid;
      }
      out.push({ atMs: hi, from: prevOffset, to: offset });
    }
    prevMs = t;
    prevOffset = offset;
  }
  return out;
}

/** A VTIMEZONE with explicit observances covering the given years (no RRULE needed). */
export function buildVTimezone(tzid: string, fromYear: number, toYear: number): string[] {
  const fromMs = Date.UTC(fromYear, 0, 1);
  const toMs = Date.UTC(toYear + 1, 0, 1);
  const initial = tzOffsetMinutes(fromMs, tzid);
  const transitions = findTransitions(tzid, fromMs, toMs);
  const standardOffset = Math.min(initial, ...transitions.map((t) => t.to));
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`];
  const observance = (startLocal: string, from: number, to: number) => {
    const type = to > standardOffset ? 'DAYLIGHT' : 'STANDARD';
    lines.push(
      `BEGIN:${type}`,
      `DTSTART:${startLocal}`,
      `TZOFFSETFROM:${formatOffset(from)}`,
      `TZOFFSETTO:${formatOffset(to)}`,
      `END:${type}`,
    );
  };
  observance('19700101T000000', initial, initial);
  for (const t of transitions) {
    // DTSTART is the local time in effect before the onset.
    observance(compactUtc(t.atMs + t.from * 60_000).replace('Z', ''), t.from, t.to);
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

export function buildIcs(calendar: IcsCalendarInput): string {
  const dtstamp = compactUtc(calendar.dtstamp ?? Date.now());
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${calendar.prodId}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (calendar.name) lines.push(`NAME:${escapeText(calendar.name)}`, `X-WR-CALNAME:${escapeText(calendar.name)}`);
  if (calendar.description) {
    lines.push(`DESCRIPTION:${escapeText(calendar.description)}`, `X-WR-CALDESC:${escapeText(calendar.description)}`);
  }
  if (calendar.timeZone) lines.push(`X-WR-TIMEZONE:${calendar.timeZone}`);
  if (calendar.refreshInterval) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${calendar.refreshInterval}`, `X-PUBLISHED-TTL:${calendar.refreshInterval}`);
  }

  const zoneYears = new Map<string, { min: number; max: number }>();
  for (const event of calendar.events) {
    for (const value of [event.start, event.end]) {
      if (value?.kind !== 'zoned') continue;
      const year = Number(value.date.slice(0, 4));
      const range = zoneYears.get(value.tzid);
      zoneYears.set(value.tzid, range ? { min: Math.min(range.min, year), max: Math.max(range.max, year) } : { min: year, max: year });
    }
  }
  for (const [tzid, range] of zoneYears) {
    if (isValidTimeZone(tzid)) lines.push(...buildVTimezone(tzid, range.min, range.max));
  }

  for (const event of calendar.events) {
    const end = event.end ?? (event.start.kind === 'date' ? { kind: 'date' as const, date: nextDay(event.start.date) } : event.start);
    lines.push('BEGIN:VEVENT', `UID:${escapeText(event.uid)}`, `DTSTAMP:${dtstamp}`, dateProperty('DTSTART', event.start), dateProperty('DTEND', end));
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL;VALUE=URI:${event.url}`);
    if (event.categories && event.categories.length > 0) {
      lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);
    }
    if (event.status) lines.push(`STATUS:${event.status}`);
    if (event.transparent) lines.push('TRANSP:TRANSPARENT');
    if (event.lastModified) lines.push(`LAST-MODIFIED:${compactUtc(event.lastModified)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParsedIcsEvent {
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  categories: string[];
  start: IcsDateTime | null;
  end: IcsDateTime | null;
  status: string | null;
}

export interface ParsedIcs {
  name: string | null;
  timeZone: string | null;
  events: ParsedIcsEvent[];
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Windows zone names some LMS exports use in TZID. */
const WINDOWS_ZONES: Record<string, string> = {
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'e. europe standard time': 'Europe/Chisinau',
  'aus eastern standard time': 'Australia/Sydney',
  'new zealand standard time': 'Pacific/Auckland',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'singapore standard time': 'Asia/Singapore',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
};

export function normalizeTzid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let tzid = raw.trim().replace(/^"|"$/g, '');
  if (tzid.startsWith('/')) tzid = tzid.slice(1); // "/America/New_York" (vendor-prefixed)
  tzid = tzid.replace(/^(?:mozilla\.org|freeassociation\.sourceforge\.net)\/[^/]+\//i, '');
  if (isValidTimeZone(tzid)) return tzid;
  const mapped = WINDOWS_ZONES[tzid.toLowerCase()];
  return mapped ?? null;
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

function splitUnescaped(value: string, separator: ','): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[i + 1];
      i++;
    } else if (ch === separator) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function parseContentLine(line: string): ContentLine | null {
  let i = 0;
  let inQuotes = false;
  let nameEnd = -1;
  let valueStart = -1;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';' && nameEnd < 0) nameEnd = i;
    else if (!inQuotes && ch === ':') {
      valueStart = i + 1;
      if (nameEnd < 0) nameEnd = i;
      break;
    }
  }
  if (valueStart < 0) return null;
  const name = line.slice(0, nameEnd).trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  const paramText = line.slice(nameEnd, valueStart - 1);
  const paramPattern = /;([^=;:]+)=("[^"]*"|[^;:]*)/g;
  for (let m = paramPattern.exec(paramText); m; m = paramPattern.exec(paramText)) {
    params[m[1].trim().toUpperCase()] = m[2].replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(valueStart) };
}

function parseDateValue(line: ContentLine, defaultTz: string | null): IcsDateTime | null {
  const value = line.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || line.params.VALUE?.toUpperCase() === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return isISODate(date) ? { kind: 'date', date } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(value);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isISODate(date) || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  const time = `${m[4]}:${m[5]}`;
  const seconds = m[6] ?? '00';
  if (m[7]) return { kind: 'utc', instant: `${date}T${time}:${seconds}Z` };
  // Unknown TZIDs and floating times fall back to the calendar's X-WR-TIMEZONE, as clients do.
  const tzid = normalizeTzid(line.params.TZID) ?? defaultTz;
  if (tzid === 'UTC') return { kind: 'utc', instant: `${date}T${time}:${seconds}Z` };
  if (tzid) return { kind: 'zoned', date, time, tzid };
  return { kind: 'floating', date, time };
}

/** Unfolds and splits an iCalendar document into content lines. */
function contentLines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

export function parseIcs(text: string): ParsedIcs {
  const lines = contentLines(text);
  let name: string | null = null;
  let calendarTz: string | null = null;
  const events: ParsedIcsEvent[] = [];

  // Raw lines per event so X-WR-TIMEZONE (which may come after events) applies to all.
  const rawEvents: ContentLine[][] = [];
  let current: ContentLine[] | null = null;
  let nested = 0;
  for (const raw of lines) {
    const line = parseContentLine(raw);
    if (!line) continue;
    if (line.name === 'BEGIN') {
      const component = line.value.trim().toUpperCase();
      if (component === 'VEVENT' && !current) {
        current = [];
        nested = 0;
      } else if (current) nested++;
      continue;
    }
    if (line.name === 'END') {
      const component = line.value.trim().toUpperCase();
      if (current && nested > 0) nested--;
      else if (current && component === 'VEVENT') {
        rawEvents.push(current);
        current = null;
      }
      continue;
    }
    if (current) {
      if (nested === 0) current.push(line);
    } else if (line.name === 'X-WR-CALNAME' || (line.name === 'NAME' && !name)) {
      name = unescapeText(line.value).trim() || name;
    } else if (line.name === 'X-WR-TIMEZONE') {
      calendarTz = normalizeTzid(line.value);
    }
  }

  for (const props of rawEvents) {
    const get = (prop: string) => props.find((p) => p.name === prop);
    const text = (prop: string) => {
      const p = get(prop);
      return p ? unescapeText(p.value).trim() : null;
    };
    const dtstart = get('DTSTART');
    const dtend = get('DTEND') ?? get('DUE');
    const categories = props
      .filter((p) => p.name === 'CATEGORIES')
      .flatMap((p) => splitUnescaped(p.value, ','))
      .map((c) => unescapeText(c).trim())
      .filter((c) => c.length > 0);
    events.push({
      uid: text('UID'),
      summary: text('SUMMARY') ?? '',
      description: text('DESCRIPTION'),
      location: text('LOCATION'),
      url: get('URL')?.value.trim() ?? null,
      categories,
      start: dtstart ? parseDateValue(dtstart, calendarTz) : null,
      end: dtend ? parseDateValue(dtend, calendarTz) : null,
      status: text('STATUS')?.toUpperCase() ?? null,
    });
  }
  return { name, timeZone: calendarTz, events };
}

/**
 * A parsed date/time in the student's zone. All-day values keep their date; floating times are
 * taken as already local.
 */
export function toLocal(value: IcsDateTime, timeZone: string): { date: ISODate; time: LocalTime | null } {
  const zone = resolveTimeZone(timeZone);
  switch (value.kind) {
    case 'date':
      return { date: value.date, time: null };
    case 'floating':
      return { date: value.date, time: value.time };
    case 'utc':
      return utcToLocal(value.instant, zone);
    case 'zoned':
      return utcToLocal(localToUtcMs(value.date, value.time, value.tzid), zone);
  }
}

/** The instant an ICS value denotes (all-day / floating values are read in `timeZone`). */
export function toInstantMs(value: IcsDateTime, timeZone: string): number {
  const zone = resolveTimeZone(timeZone);
  switch (value.kind) {
    case 'date':
      return localToUtcMs(value.date, '00:00', zone);
    case 'floating':
      return localToUtcMs(value.date, value.time, zone);
    case 'utc':
      return Date.parse(value.instant);
    case 'zoned':
      return localToUtcMs(value.date, value.time, value.tzid);
  }
}
