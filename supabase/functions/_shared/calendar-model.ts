// The calendar domain model shared by calendar-sync, ics-feed, canvas, and lms-sync.
// Runtime-agnostic (Deno and Node): no Deno APIs, only ./x.ts imports.
//
//   1. Time zones   — Intl-based conversion between instants and the student's local wall clock.
//   2. Weights      — effective weight / high-impact rules from docs/ENGINE.md (local copy; the
//                     functions must not import src/engine).
//   3. Entries      — what one item or plan block looks like on an external calendar, + its hash.
//   4. Sync planner — pure two-way reconciliation of desired entries against pushed links and
//                     what the provider reports (see the contract at the top of calendar-sync).
//   5. Provider HTTP — JSON requests to Google / Microsoft with token refresh and backoff.
import type { CloudCalendarProvider } from './api.ts';
import { sha256Hex } from './crypto.ts';

export type ISODate = string;
/** Local wall-clock time `HH:MM` (seconds allowed on input). */
export type LocalTime = string;

// ---------------------------------------------------------------------------
// 1. Time zones
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
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
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    wallClockFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The student's zone when valid, otherwise the fallback (default UTC). */
export function resolveTimeZone(timeZone: string | null | undefined, fallback = 'UTC'): string {
  return isValidTimeZone(timeZone) ? timeZone : fallback;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC offset of `timeZone` at the instant `ms`, in minutes east of UTC (New York in winter: -300). */
export function tzOffsetMinutes(ms: number, timeZone: string): number {
  const wholeSecond = Math.floor(ms / 1000) * 1000;
  const w = wallClock(wholeSecond, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - wholeSecond) / MINUTE_MS);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatDateParts(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isLocalTime(value: unknown): value is LocalTime {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

/** Normalizes Postgres `time` output ("16:30:00") to "16:30". */
export function toHHMM(time: string | null | undefined): LocalTime | null {
  return isLocalTime(time) ? time.slice(0, 5) : null;
}

function toMs(instant: string | number | Date): number {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${String(instant)}`);
  return ms;
}

/** An instant as the student's local calendar date and wall-clock time ("HH:MM"). */
export function utcToLocal(instant: string | number | Date, timeZone: string): { date: ISODate; time: LocalTime } {
  const w = wallClock(toMs(instant), timeZone);
  return { date: formatDateParts(w.year, w.month, w.day), time: `${pad2(w.hour)}:${pad2(w.minute)}` };
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` + `time`. Ambiguous times (the
 * repeated hour when clocks fall back) resolve to the first occurrence; nonexistent times (the
 * skipped hour when clocks spring forward) move forward by the size of the gap.
 */
export function localToUtcMs(date: ISODate, time: LocalTime, timeZone: string): number {
  if (!isISODate(date) || !isLocalTime(time)) throw new RangeError(`Invalid local date/time: ${date} ${time}`);
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  const before = tzOffsetMinutes(naive - DAY_MS, timeZone);
  const after = tzOffsetMinutes(naive + DAY_MS, timeZone);
  const valid = [before, after]
    .map((offset) => naive - offset * MINUTE_MS)
    .filter((ms, i) => tzOffsetMinutes(ms, timeZone) === (i === 0 ? before : after));
  if (valid.length > 0) return Math.min(...valid);
  return naive - before * MINUTE_MS;
}

export function localToUtcIso(date: ISODate, time: LocalTime, timeZone: string): string {
  return new Date(localToUtcMs(date, time, timeZone)).toISOString();
}

/** Today's local date in `timeZone`. */
export function todayInZone(timeZone: string, now: number | Date = Date.now()): ISODate {
  return utcToLocal(now, timeZone).date;
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return formatDateParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function diffDays(from: ISODate, to: ISODate): number {
  const toUtc = (s: ISODate) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Tue, Nov 3" — locale-independent so server output is stable. */
export function formatDateLabel(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${MONTHS[m - 1]} ${d}`;
}

/** "4:30 PM" */
export function formatTimeLabel(time: LocalTime): string {
  const [h, m] = time.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------------------
// 2. Weights (docs/ENGINE.md "Effective weight" and "High impact")
// ---------------------------------------------------------------------------

export const MAJOR_KINDS: ReadonlySet<string> = new Set(['exam', 'paper', 'project', 'presentation']);

export interface WeightedItem {
  id: string;
  component_id: string | null;
  kind: string;
  weight_override: number | null;
  is_major: boolean;
  high_impact_override: boolean | null;
}

export interface WeightedComponent {
  id: string;
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
}

/**
 * Precomputes per-item effective weight (% of the course grade): the item's override, else its
 * component weight ÷ N where N = max(expected_count, linked items), reduced by drop_lowest when
 * that keeps N ≥ 1; null when unknown.
 */
export function effectiveWeights(items: WeightedItem[], components: WeightedComponent[]): Map<string, number | null> {
  const byId = new Map(components.map((c) => [c.id, c]));
  const linked = new Map<string, number>();
  for (const item of items) {
    if (item.component_id) linked.set(item.component_id, (linked.get(item.component_id) ?? 0) + 1);
  }
  const out = new Map<string, number | null>();
  for (const item of items) {
    if (item.weight_override !== null && item.weight_override !== undefined) {
      out.set(item.id, Number(item.weight_override));
      continue;
    }
    const component = item.component_id ? byId.get(item.component_id) : undefined;
    if (!component) {
      out.set(item.id, null);
      continue;
    }
    let n = Math.max(component.expected_count ?? 0, linked.get(component.id) ?? 0);
    if (n - component.drop_lowest >= 1) n -= component.drop_lowest;
    out.set(item.id, n === 0 ? null : Number(component.weight) / n);
  }
  return out;
}

export function isHighImpact(item: WeightedItem, weight: number | null, threshold: number): boolean {
  if (item.high_impact_override !== null && item.high_impact_override !== undefined) return item.high_impact_override;
  if (weight !== null) {
    if (weight >= threshold) return true;
    return MAJOR_KINDS.has(item.kind) && item.kind !== 'presentation' && weight >= threshold / 2;
  }
  return item.is_major || MAJOR_KINDS.has(item.kind);
}

export function formatPercent(weight: number): string {
  return `${Number(weight.toFixed(1))}%`;
}

// ---------------------------------------------------------------------------
// 3. Entries
// ---------------------------------------------------------------------------

export const ITEM_KIND_LABELS: Record<string, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  paper: 'Paper',
  project: 'Project',
  homework: 'Homework',
  reading: 'Reading',
  presentation: 'Presentation',
  lab: 'Lab',
  discussion: 'Discussion',
  other: 'Deadline',
};

/** Length of the timed event that ends at an item's due time. */
export const TIMED_EVENT_MINUTES = 30;
export const HIGH_IMPACT_MARK = '★';

export interface CalendarEntry {
  /** `item:<items.id>` or `block:<plan_blocks.key>` */
  key: string;
  itemId: string | null;
  title: string;
  description: string;
  date: ISODate;
  /** Local due time; null = all-day. Timed entries end at this time. */
  time: LocalTime | null;
  durationMinutes: number;
  timeZone: string;
  /** Deep link into the app. */
  url: string;
}

export interface EntryCourse {
  id: string;
  code: string | null;
  title: string;
}

export interface EntryItem extends WeightedItem {
  title: string;
  due_date: ISODate | null;
  due_time: string | null;
  status: string;
}

export interface EntryBlock {
  key: string;
  item_id: string;
  date: ISODate;
  minutes: number;
  kind: string;
  label: string;
}

export function courseLabel(course: EntryCourse): string {
  return (course.code?.trim() || course.title.trim() || 'Course').slice(0, 40);
}

export function itemDeepLink(itemId: string): string {
  return `termwise://item/${itemId}`;
}

/** Summary line shared by calendar-sync and ics-feed: "★ PSY 101: Midterm 1". */
export function itemSummary(item: EntryItem, course: EntryCourse, highImpact: boolean): string {
  const prefix = item.status === 'done' ? '✓ ' : highImpact ? `${HIGH_IMPACT_MARK} ` : '';
  return `${prefix}${courseLabel(course)}: ${item.title.trim()}`;
}

export function itemDescription(item: EntryItem, course: EntryCourse, weight: number | null): string {
  const kind = ITEM_KIND_LABELS[item.kind] ?? 'Deadline';
  const lines = [weight !== null ? `${kind} · Worth ${formatPercent(weight)} of ${courseLabel(course)}` : `${kind} · ${course.title}`];
  const time = toHHMM(item.due_time);
  if (time) lines.push(`Due ${formatTimeLabel(time)}`);
  lines.push(`Open in Termwise: ${itemDeepLink(item.id)}`);
  return lines.join('\n');
}

export function itemEntry(
  item: EntryItem & { due_date: ISODate },
  course: EntryCourse,
  weight: number | null,
  highImpact: boolean,
  timeZone: string,
): CalendarEntry {
  return {
    key: `item:${item.id}`,
    itemId: item.id,
    title: itemSummary(item, course, highImpact),
    description: itemDescription(item, course, weight),
    date: item.due_date,
    time: toHHMM(item.due_time),
    durationMinutes: TIMED_EVENT_MINUTES,
    timeZone,
    url: itemDeepLink(item.id),
  };
}

export function blockEntry(block: EntryBlock, course: EntryCourse, timeZone: string): CalendarEntry {
  return {
    key: `block:${block.key}`,
    itemId: null,
    title: `${courseLabel(course)}: ${block.label} (${block.minutes} min)`,
    description: `Study plan block from Termwise.\nOpen in Termwise: ${itemDeepLink(block.item_id)}`,
    date: block.date,
    time: null,
    durationMinutes: block.minutes,
    timeZone,
    url: itemDeepLink(block.item_id),
  };
}

/** Start/end instants of a timed entry (it ends at the due time). */
export function timedRange(entry: CalendarEntry): { startMs: number; endMs: number } {
  if (!entry.time) throw new Error('timedRange() needs a timed entry');
  const endMs = localToUtcMs(entry.date, entry.time, entry.timeZone);
  return { startMs: endMs - entry.durationMinutes * MINUTE_MS, endMs };
}

export type ExternalKind = 'event' | 'task';

/** Payload hash stored in calendar_event_links.pushed_hash. */
export async function entryHash(entry: CalendarEntry, kind: ExternalKind): Promise<string> {
  const material = JSON.stringify([
    1,
    kind,
    entry.title,
    entry.description,
    entry.date,
    entry.time,
    entry.time ? entry.durationMinutes : null,
    entry.time ? entry.timeZone : null,
  ]);
  return (await sha256Hex(material)).slice(0, 32);
}

// ---------------------------------------------------------------------------
// 4. Sync planner
// ---------------------------------------------------------------------------

export interface LinkState {
  id: string;
  key: string;
  external_id: string;
  external_kind: ExternalKind;
  pushed_hash: string | null;
  pushed_date: ISODate | null;
}

/** What the provider reports about one external event / task. */
export interface ExternalObservation {
  externalId: string;
  deleted: boolean;
  /** Local due date as shown externally (timed events: the date the event ends). */
  date: ISODate | null;
  /** Local end time for timed events, null for all-day events and tasks. */
  time: LocalTime | null;
  /** Our entry key when the provider stores it (Google / Microsoft event properties). */
  key: string | null;
}

export interface ExternalSnapshot {
  /** true = full listing (absent objects were deleted); false = incremental changes only. */
  complete: boolean;
  observations: ExternalObservation[];
}

export interface DesiredEntry {
  entry: CalendarEntry;
  hash: string;
}

export interface PendingChange {
  new_due_date: ISODate | null;
  new_due_time: string | null;
  deleted?: boolean;
}

export interface DetectedChange {
  itemId: string;
  key: string;
  newDate: ISODate | null;
  newTime: LocalTime | null;
  deleted: boolean;
}

export interface SyncPlan {
  create: DesiredEntry[];
  /** Push our payload to an existing external object (link may be new when adopting an orphan). */
  update: Array<{ desired: DesiredEntry; externalId: string; linkId: string | null }>;
  /** Delete the external object and its link. */
  remove: LinkState[];
  /** The external object is already gone: delete only the link row. */
  dropLinks: LinkState[];
  /** External objects of ours that no link knows about and nothing wants: delete them. */
  removeOrphans: string[];
  externalChanges: DetectedChange[];
  /** Links confirmed unchanged (refresh last_seen_at). */
  unchanged: LinkState[];
}

export interface PlanInput {
  desired: DesiredEntry[];
  links: LinkState[];
  kind: ExternalKind;
  /** null when the provider could not be read this run (push-only). */
  snapshot: ExternalSnapshot | null;
  /** Current items.external_change per item id (from this provider), to avoid re-reporting. */
  pendingChanges: Map<string, PendingChange>;
}

function samePending(existing: PendingChange | undefined, change: DetectedChange): boolean {
  if (!existing) return false;
  return (
    existing.new_due_date === change.newDate &&
    toHHMM(existing.new_due_time) === change.newTime &&
    Boolean(existing.deleted) === change.deleted
  );
}

/**
 * Pure two-way reconciliation. Our side wins whenever our payload changed since the last push;
 * otherwise a date the student changed externally becomes an external change to review.
 */
export function planCalendarSync(input: PlanInput): SyncPlan {
  const plan: SyncPlan = {
    create: [],
    update: [],
    remove: [],
    dropLinks: [],
    removeOrphans: [],
    externalChanges: [],
    unchanged: [],
  };
  const desiredByKey = new Map(input.desired.map((d) => [d.entry.key, d]));
  const linkByKey = new Map(input.links.map((l) => [l.key, l]));
  const observations = new Map((input.snapshot?.observations ?? []).map((o) => [o.externalId, o]));
  const complete = input.snapshot?.complete ?? false;
  const linkedExternalIds = new Set(input.links.map((l) => l.external_id));

  const observe = (externalId: string): ExternalObservation | 'gone' | null => {
    const o = observations.get(externalId);
    if (o?.deleted) return 'gone';
    if (o) return o;
    return input.snapshot && complete ? 'gone' : null;
  };
  const report = (change: DetectedChange) => {
    if (!samePending(input.pendingChanges.get(change.itemId), change)) plan.externalChanges.push(change);
  };

  // Orphans we can recognise by key (e.g. after reconnecting to an existing "Termwise" calendar).
  const adoptable = new Map<string, string>();
  if (input.snapshot) {
    for (const o of observations.values()) {
      if (o.deleted || !o.key || linkedExternalIds.has(o.externalId)) continue;
      if (desiredByKey.has(o.key) && !linkByKey.has(o.key) && !adoptable.has(o.key)) adoptable.set(o.key, o.externalId);
      else if (complete) plan.removeOrphans.push(o.externalId);
    }
  }

  for (const link of input.links) {
    const desired = desiredByKey.get(link.key);
    if (!desired || link.external_kind !== input.kind) {
      // The snapshot only covers the current kind's container, so it says nothing about the other.
      if (link.external_kind === input.kind && observe(link.external_id) === 'gone') plan.dropLinks.push(link);
      else plan.remove.push(link);
      continue;
    }
    const ours = link.pushed_hash === desired.hash;
    const seen = observe(link.external_id);
    const itemId = desired.entry.itemId;

    if (seen === 'gone') {
      if (ours && itemId) {
        report({ itemId, key: link.key, newDate: null, newTime: null, deleted: true });
        plan.dropLinks.push(link);
      } else if (ours) {
        // A plan block the student deleted stays deleted until the block itself changes.
        plan.unchanged.push(link);
      } else {
        plan.dropLinks.push(link);
        plan.create.push(desired);
      }
      continue;
    }
    if (!ours) {
      plan.update.push({ desired, externalId: link.external_id, linkId: link.id });
      continue;
    }
    if (seen && itemId && seen.date !== link.pushed_date) {
      report({ itemId, key: link.key, newDate: seen.date, newTime: seen.time, deleted: false });
    }
    plan.unchanged.push(link);
  }

  for (const desired of input.desired) {
    if (linkByKey.has(desired.entry.key) && linkByKey.get(desired.entry.key)?.external_kind === input.kind) continue;
    const itemId = desired.entry.itemId;
    // The student deleted this item's event and hasn't decided yet: don't resurrect it.
    if (itemId && input.pendingChanges.get(itemId)?.deleted) continue;
    const orphan = adoptable.get(desired.entry.key);
    if (orphan) plan.update.push({ desired, externalId: orphan, linkId: null });
    else if (!plan.create.includes(desired)) plan.create.push(desired);
  }
  return plan;
}

/** Name of the dedicated calendar / task list Termwise owns in the student's account. */
export const CONTAINER_NAME = 'Termwise';

/** One provider (Google or Microsoft) as seen by calendar-sync. */
export interface CalendarAdapter {
  readonly provider: CloudCalendarProvider;
  /**
   * Id of the dedicated calendar (kind 'event') or task list (kind 'task'): `knownId` when set,
   * else an existing container named "Termwise", else a new one.
   */
  ensureContainer(kind: ExternalKind, knownId: string | null, timeZone: string): Promise<string>;
  /**
   * Current external state. `cursor` is the provider's incremental-sync token from the previous
   * run (Google Calendar); providers without one always return a complete listing.
   * Throws ProviderError with isGone when the container itself no longer exists.
   */
  snapshot(
    kind: ExternalKind,
    containerId: string,
    cursor: string | null,
    timeZone: string,
  ): Promise<{ snapshot: ExternalSnapshot; cursor: string | null }>;
  create(kind: ExternalKind, containerId: string, entry: CalendarEntry): Promise<string>;
  /** Throws ProviderError with isGone when the object was deleted externally. */
  update(kind: ExternalKind, containerId: string, externalId: string, entry: CalendarEntry): Promise<void>;
  /** Already-deleted objects are not an error. */
  remove(kind: ExternalKind, containerId: string, externalId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 5. Provider HTTP
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  constructor(
    readonly provider: CloudCalendarProvider,
    readonly status: number,
    message: string,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
  get isGone(): boolean {
    return this.status === 404 || this.status === 410;
  }
}

/** The refresh token was revoked or expired: the student must reconnect. */
export class ReauthRequiredError extends Error {
  constructor(readonly provider: CloudCalendarProvider) {
    super(`${provider} access was revoked`);
    this.name = 'ReauthRequiredError';
  }
}

export interface AccessTokenSource {
  /** Returns a valid access token; `forceRefresh` after the provider rejected the current one. */
  get(forceRefresh?: boolean): Promise<string>;
}

export interface ProviderRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelayMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  const base = Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt;
  return Math.min(base, 8000);
}

function errorDetails(body: unknown): { message: string | null; reason: string | null } {
  if (typeof body !== 'object' || body === null) return { message: null, reason: null };
  const b = body as { error?: unknown; error_description?: unknown };
  if (typeof b.error === 'string') {
    return { message: typeof b.error_description === 'string' ? b.error_description : b.error, reason: b.error };
  }
  if (typeof b.error === 'object' && b.error !== null) {
    const e = b.error as { message?: unknown; code?: unknown; status?: unknown; errors?: Array<{ reason?: unknown }> };
    const reason =
      (Array.isArray(e.errors) && typeof e.errors[0]?.reason === 'string' ? e.errors[0].reason : null) ??
      (typeof e.code === 'string' ? e.code : typeof e.status === 'string' ? e.status : null);
    return { message: typeof e.message === 'string' ? e.message : null, reason };
  }
  return { message: null, reason: null };
}

const GOOGLE_RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

/**
 * Authorized JSON request with one forced token refresh on 401 and backoff on throttling or
 * transient failures. Returns null for empty (204) responses.
 */
export async function providerJson<T>(
  provider: CloudCalendarProvider,
  tokens: AccessTokenSource,
  request: ProviderRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
  let forceRefresh = false;
  for (let attempt = 0; ; attempt++) {
    const token = await tokens.get(forceRefresh);
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(request.headers ?? {}),
        },
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt + 1 < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new ProviderError(provider, 0, timedOut ? 'The calendar service timed out.' : 'Could not reach the calendar service.');
    }

    if (response.status === 204) return null;
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (response.ok) return body as T;

    const { message, reason } = errorDetails(body);
    if (response.status === 401 && !forceRefresh) {
      forceRefresh = true;
      continue;
    }
    const throttled =
      RETRYABLE.has(response.status) || (response.status === 403 && reason !== null && GOOGLE_RATE_REASONS.has(reason));
    if (throttled && attempt + 1 < MAX_ATTEMPTS) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    throw new ProviderError(provider, response.status, message ?? `Request failed with status ${response.status}.`, reason);
  }
}

/** Form-encoded POST to an OAuth token endpoint. Throws ReauthRequiredError on invalid_grant. */
export async function oauthTokenRequest<T>(
  provider: CloudCalendarProvider,
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderError(provider, 0, 'Could not reach the sign-in service.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;
  const { message, reason } = errorDetails(body);
  if (reason === 'invalid_grant') throw new ReauthRequiredError(provider);
  throw new ProviderError(provider, response.status, message ?? 'The sign-in service rejected the request.', reason);
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
