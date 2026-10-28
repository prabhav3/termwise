// Pure two-way reconciliation for the on-device Apple Calendar / Reminders sync.
// No React Native, no Expo: it runs unchanged in vitest. src/lib/calendar/apple.ts feeds it
// what Termwise wants on the calendar (desired entries), what we pushed last time (links), and
// what the device reports now (observations), then applies the resulting plan with expo-calendar.
//
// Rules (they mirror calendar-sync for Google / Outlook):
//   * Our side wins whenever our payload changed since the last push (hash differs, or the link's
//     pushed_hash is null — that is how "Keep mine" asks for a re-push).
//   * Otherwise a date the student changed in Calendar becomes an external change to review, and a
//     deleted event becomes { deleted: true } (its link is dropped).
//   * A deleted plan-block event stays deleted until the block itself changes.
//   * Entries no longer wanted are deleted from the device.

export type ISODate = string;
export type ExternalKind = 'event' | 'task';

/** Name of the calendar / Reminders list Termwise owns on the device. */
export const CONTAINER_TITLE = 'Termwise';
/** Plan blocks are pushed for this many days ahead (today included). */
export const PLAN_BLOCK_DAYS = 30;
/** A timed deadline shows as a short event that ends at the due time. */
export const TIMED_EVENT_MINUTES = 30;
export const HIGH_IMPACT_MARK = '★';
export const DONE_MARK = '✓';

const KIND_LABELS: Record<string, string> = {
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

// ---- entries -------------------------------------------------------------------------------

export interface CalendarEntry {
  /** `item:<items.id>` or `block:<plan_blocks.key>` (calendar_event_links.key). */
  key: string;
  itemId: string | null;
  title: string;
  notes: string;
  /** Deep link into the app. */
  url: string;
  date: ISODate;
  /** Local due time `HH:MM`; null = all-day. Timed entries end at this time. */
  time: string | null;
  durationMinutes: number;
  /** The student's time zone (profiles.timezone), used for timed entries. */
  timeZone: string;
}

export interface DesiredEntry {
  entry: CalendarEntry;
  hash: string;
}

export interface EntryCourse {
  id: string;
  code: string | null;
  title: string;
  archived: boolean;
}

export interface EntryItem {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  due_date: ISODate | null;
  due_time: string | null;
  status: string;
}

export interface EntryBlock {
  key: string;
  item_id: string;
  course_id: string;
  date: ISODate;
  minutes: number;
  label: string;
  status: string;
}

export interface DesiredInput {
  items: readonly EntryItem[];
  courses: readonly EntryCourse[];
  blocks: readonly EntryBlock[];
  includeBlocks: boolean;
  today: ISODate;
  timeZone: string;
  kind: ExternalKind;
  /** Effective weight (% of the course grade) per item id, when known. */
  weights: ReadonlyMap<string, number | null>;
  highImpactIds: ReadonlySet<string>;
}

export const itemKey = (itemId: string) => `item:${itemId}`;
export const blockKey = (planBlockKey: string) => `block:${planBlockKey}`;
export const itemDeepLink = (itemId: string) => `termwise://item/${itemId}`;

/** "16:30:00" -> "16:30"; anything else -> null. */
export function toHHMM(time: string | null | undefined): string | null {
  if (!time) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(time.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

export function courseLabel(course: Pick<EntryCourse, 'code' | 'title'>): string {
  return (course.code?.trim() || course.title.trim() || 'Course').slice(0, 40);
}

function formatPercent(weight: number): string {
  return `${Number(weight.toFixed(1))}%`;
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Calendar arithmetic on `YYYY-MM-DD` (UTC midnights, so DST never shifts a day). */
export function addDaysSafe(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** "★ PSY 101: Midterm 1" (✓ once done). */
export function itemTitle(item: EntryItem, course: EntryCourse, highImpact: boolean): string {
  const prefix = item.status === 'done' ? `${DONE_MARK} ` : highImpact ? `${HIGH_IMPACT_MARK} ` : '';
  return `${prefix}${courseLabel(course)}: ${item.title.trim()}`;
}

export function itemNotes(item: EntryItem, course: EntryCourse, weight: number | null): string {
  const kind = KIND_LABELS[item.kind] ?? 'Deadline';
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
    key: itemKey(item.id),
    itemId: item.id,
    title: itemTitle(item, course, highImpact),
    notes: itemNotes(item, course, weight),
    url: itemDeepLink(item.id),
    date: item.due_date,
    time: toHHMM(item.due_time),
    durationMinutes: TIMED_EVENT_MINUTES,
    timeZone,
  };
}

export function blockEntry(block: EntryBlock, course: EntryCourse, timeZone: string): CalendarEntry {
  return {
    key: blockKey(block.key),
    itemId: null,
    title: `${courseLabel(course)}: ${block.label}`,
    notes: `Study block from your Termwise plan (${Math.round(block.minutes)} min).\nOpen in Termwise: ${itemDeepLink(block.item_id)}`,
    url: itemDeepLink(block.item_id),
    date: block.date,
    time: null,
    durationMinutes: Math.round(block.minutes),
    timeZone,
  };
}

/** 53-bit string hash (cyrb53). Not cryptographic: it only detects that a payload changed. */
export function stringHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Payload hash stored in calendar_event_links.pushed_hash. */
export function entryHash(entry: CalendarEntry, kind: ExternalKind): string {
  return stringHash(
    JSON.stringify([
      'apple-1',
      kind,
      entry.title,
      entry.notes,
      entry.url,
      entry.date,
      entry.time,
      entry.time ? entry.durationMinutes : null,
      entry.time ? entry.timeZone : null,
    ]),
  );
}

/**
 * What should be on the device: every dated item of a non-archived course, plus planned study
 * blocks for the next PLAN_BLOCK_DAYS days when the connection asks for them.
 */
export function buildDesiredEntries(input: DesiredInput): DesiredEntry[] {
  const courses = new Map(input.courses.filter((course) => !course.archived).map((course) => [course.id, course]));
  const entries: CalendarEntry[] = [];

  for (const item of input.items) {
    if (!item.due_date) continue;
    const course = courses.get(item.course_id);
    if (!course) continue;
    const weight = input.weights.get(item.id) ?? null;
    entries.push(
      itemEntry({ ...item, due_date: item.due_date }, course, weight, input.highImpactIds.has(item.id), input.timeZone),
    );
  }

  if (input.includeBlocks) {
    const end = addDaysSafe(input.today, PLAN_BLOCK_DAYS);
    for (const block of input.blocks) {
      if (block.status !== 'planned' || block.date < input.today || block.date >= end) continue;
      const course = courses.get(block.course_id);
      if (course) entries.push(blockEntry(block, course, input.timeZone));
    }
  }

  const seen = new Set<string>();
  const desired: DesiredEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    desired.push({ entry, hash: entryHash(entry, input.kind) });
  }
  return desired;
}

// ---- reconciliation ------------------------------------------------------------------------

export interface LinkState {
  id: string;
  key: string;
  external_id: string;
  external_kind: ExternalKind;
  pushed_hash: string | null;
  pushed_date: ISODate | null;
}

/** What the device reports about one linked event / reminder. */
export type Observation =
  | { found: true; date: ISODate | null; time: string | null }
  | { found: false };

/** The item's current external_change, when it came from this provider. */
export interface PendingChange {
  new_due_date: ISODate | null;
  new_due_time: string | null;
  deleted?: boolean;
}

export interface DetectedChange {
  itemId: string;
  key: string;
  newDate: ISODate | null;
  newTime: string | null;
  deleted: boolean;
}

export interface SyncPlanInput {
  desired: readonly DesiredEntry[];
  links: readonly LinkState[];
  kind: ExternalKind;
  /** externalId -> what the device reports. Ids that are absent could not be checked this run. */
  observed: ReadonlyMap<string, Observation>;
  /** Pending external changes of this provider, by item id (avoids re-reporting them). */
  pending: ReadonlyMap<string, PendingChange>;
  /** Items with an undecided change from another provider: one pending decision at a time. */
  blockedItems?: ReadonlySet<string>;
}

export interface SyncPlan {
  create: DesiredEntry[];
  /** Push our payload over the existing external object. */
  update: { desired: DesiredEntry; link: LinkState }[];
  /** Delete the external object and its link. */
  remove: LinkState[];
  /** The external object is already gone: delete only the link. */
  dropLinks: LinkState[];
  externalChanges: DetectedChange[];
  unchanged: LinkState[];
}

function samePending(existing: PendingChange | undefined, change: DetectedChange): boolean {
  if (!existing) return false;
  return (
    existing.new_due_date === change.newDate &&
    toHHMM(existing.new_due_time) === change.newTime &&
    Boolean(existing.deleted) === change.deleted
  );
}

export function planAppleSync(input: SyncPlanInput): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], dropLinks: [], externalChanges: [], unchanged: [] };
  const desiredByKey = new Map(input.desired.map((desired) => [desired.entry.key, desired]));
  const blocked = input.blockedItems ?? new Set<string>();
  const handledKeys = new Set<string>();

  const report = (change: DetectedChange) => {
    if (blocked.has(change.itemId)) return;
    if (!samePending(input.pending.get(change.itemId), change)) plan.externalChanges.push(change);
  };

  for (const link of input.links) {
    const desired = desiredByKey.get(link.key);
    const seen = input.observed.get(link.external_id);

    if (!desired || link.external_kind !== input.kind) {
      if (seen && !seen.found) plan.dropLinks.push(link);
      else plan.remove.push(link);
      continue;
    }
    handledKeys.add(link.key);
    const ours = link.pushed_hash !== null && link.pushed_hash === desired.hash;
    const itemId = desired.entry.itemId;

    if (seen && !seen.found) {
      if (ours && itemId) {
        report({ itemId, key: link.key, newDate: null, newTime: null, deleted: true });
        plan.dropLinks.push(link);
      } else if (ours) {
        plan.unchanged.push(link);
      } else {
        plan.dropLinks.push(link);
        plan.create.push(desired);
      }
      continue;
    }
    if (!ours) {
      plan.update.push({ desired, link });
      continue;
    }
    if (seen && seen.found && itemId && seen.date !== null && seen.date !== link.pushed_date) {
      report({ itemId, key: link.key, newDate: seen.date, newTime: seen.time, deleted: false });
    }
    plan.unchanged.push(link);
  }

  for (const desired of input.desired) {
    if (handledKeys.has(desired.entry.key)) continue;
    const itemId = desired.entry.itemId;
    // The student deleted this item's event and hasn't decided yet: don't bring it back.
    if (itemId && input.pending.get(itemId)?.deleted) continue;
    plan.create.push(desired);
  }
  return plan;
}

export function isPlanEmpty(plan: SyncPlan): boolean {
  return (
    plan.create.length === 0 &&
    plan.update.length === 0 &&
    plan.remove.length === 0 &&
    plan.dropLinks.length === 0 &&
    plan.externalChanges.length === 0
  );
}

// ---- time zones ------------------------------------------------------------------------------

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** An instant as the wall-clock date and `HH:MM` in `timeZone` (falls back to UTC for bad zones). */
export function instantToZoned(instant: Date, timeZone: string): { date: ISODate; time: string } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = wallFormatter(timeZone);
  } catch {
    formatter = wallFormatter('UTC');
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const hour = String(Number(parts.hour ?? '0') % 24).padStart(2, '0');
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute ?? '00'}` };
}
