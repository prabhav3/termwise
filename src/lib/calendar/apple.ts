// On-device Apple Calendar / Reminders sync through EventKit (expo-calendar SDK 58 object API).
// Each install keeps a random device id in the keychain and one calendar_connections row
// (provider 'apple', device_id); calendar_event_links remember what was pushed. The pure diff
// lives in ./diff.ts. Runs on demand, after every replan (the planBlocks cache is rewritten), and
// when the app returns to the foreground — throttled, one run at a time.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { calendarConnectionsQueryOptions, useCalendarConnections } from '@/data/calendarConnections';
import { componentsQueryOptions } from '@/data/components';
import { coursesQueryOptions } from '@/data/courses';
import type { RowPatch } from '@/data/database';
import { fetchEventLinks } from '@/data/eventLinks';
import { check, chunk, requireUserId, unwrap, upsertInList } from '@/data/helpers';
import { itemsQueryOptions } from '@/data/items';
import { queryKeys } from '@/data/keys';
import { planBlocksQueryOptions } from '@/data/planBlocks';
import { profileQueryOptions } from '@/data/profile';
import { computeImpact } from '@/engine';
import type {
  CalendarConnection,
  CalendarDelivery,
  CalendarEventLink,
  Course,
  ExternalChange,
  GradingComponent,
  Item,
  PlanBlock,
  Profile,
} from '@/types/db';

import { isoToLocalDate, localDateToISO, todayISO, zonedDateTimeToDate, type ISODate } from '../dates';
import { AppError, toAppError } from '../functions';
import { plannerSettings, toEngineCourse } from '../planner';
import { queryClient } from '../query-client';
import { supabase } from '../supabase';

import {
  addDaysSafe,
  buildDesiredEntries,
  CONTAINER_TITLE,
  instantToZoned,
  planAppleSync,
  type CalendarEntry,
  type DesiredEntry,
  type ExternalKind,
  type LinkState,
  type Observation,
  type PendingChange,
} from './diff';

export const isAppleCalendarSupported = Platform.OS === 'ios';

const DEVICE_ID_KEY = 'termwise.apple-calendar.device-id';
/** Termwise indigo; the calendar color shows next to every pushed event. */
const CONTAINER_COLOR = '#5B5BD6';
const LINK_BATCH = 200;
const MINUTE_MS = 60_000;
/** EventKit searches at most four years at a time. */
const MAX_SEARCH_DAYS = 4 * 365 - 2;

export const deliveryKind = (delivery: CalendarDelivery): ExternalKind => (delivery === 'task' ? 'task' : 'event');

// ---- device id ---------------------------------------------------------------------------------

let deviceIdPromise: Promise<string> | null = null;

/** A random id per install, kept in the keychain so it survives app updates. */
export function getAppleDeviceId(): Promise<string> {
  deviceIdPromise ??= (async () => {
    try {
      const saved = await SecureStore.getItemAsync(DEVICE_ID_KEY);
      if (saved) return saved;
    } catch {
      // Keychain unavailable: fall through to a fresh id for this session.
    }
    const id = Crypto.randomUUID();
    try {
      await SecureStore.setItemAsync(DEVICE_ID_KEY, id, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    } catch {
      // Not persisted; the next launch picks a new id and reconnects.
    }
    return id;
  })();
  return deviceIdPromise;
}

// ---- permissions ---------------------------------------------------------------------------------

export type ApplePermission = 'granted' | 'denied' | 'undetermined';

export interface ApplePermissions {
  calendar: ApplePermission;
  reminders: ApplePermission;
}

function toPermission(response: Calendar.PermissionResponse): ApplePermission {
  if (response.granted) return 'granted';
  if (response.status === 'undetermined' || response.canAskAgain) return 'undetermined';
  return 'denied';
}

export async function getApplePermissions(): Promise<ApplePermissions> {
  if (!isAppleCalendarSupported) return { calendar: 'denied', reminders: 'denied' };
  const read = async (get: () => Promise<Calendar.PermissionResponse>): Promise<ApplePermission> => {
    try {
      return toPermission(await get());
    } catch {
      return 'denied';
    }
  };
  const [calendar, reminders] = await Promise.all([
    read(() => Calendar.getCalendarPermissions(false)),
    read(() => Calendar.getRemindersPermissions()),
  ]);
  return { calendar, reminders };
}

/** Full access is needed: Termwise reads its events back to notice moves and deletions. */
export async function requestApplePermission(kind: ExternalKind): Promise<ApplePermission> {
  if (!isAppleCalendarSupported) return 'denied';
  try {
    const response =
      kind === 'task' ? await Calendar.requestRemindersPermissions() : await Calendar.requestCalendarPermissions(false);
    return toPermission(response);
  } catch {
    return 'denied';
  }
}

export function permissionFor(permissions: ApplePermissions, kind: ExternalKind): ApplePermission {
  return kind === 'task' ? permissions.reminders : permissions.calendar;
}

// ---- EventKit adapter ------------------------------------------------------------------------------

function entityFor(kind: ExternalKind): Calendar.EntityTypes {
  return kind === 'task' ? Calendar.EntityTypes.REMINDER : Calendar.EntityTypes.EVENT;
}

function localMidnight(date: ISODate, hours = 0, minutes = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hours, minutes, 0, 0);
}

function timedRange(entry: CalendarEntry & { time: string }): { start: Date; end: Date } {
  const end = zonedDateTimeToDate(entry.date, entry.time, entry.timeZone);
  return { start: new Date(end.getTime() - entry.durationMinutes * MINUTE_MS), end };
}

type EventDetails = Partial<Calendar.ModifiableEventProperties>;
/** expo-calendar's reminder record accepts allDay (it decides whether the due time is kept). */
type ReminderDetails = Partial<Calendar.ModifiableReminderProperties> & { allDay?: boolean };

function eventDetails(entry: CalendarEntry): EventDetails {
  const base = { title: entry.title, notes: entry.notes, url: entry.url };
  if (!entry.time) {
    return { ...base, allDay: true, startDate: localMidnight(entry.date), endDate: localMidnight(entry.date, 23, 59) };
  }
  const { start, end } = timedRange({ ...entry, time: entry.time });
  return { ...base, allDay: false, startDate: start, endDate: end, timeZone: entry.timeZone };
}

function reminderDetails(entry: CalendarEntry): ReminderDetails {
  const base = { title: entry.title, notes: entry.notes, url: entry.url };
  if (!entry.time) {
    // Noon keeps the day stable across DST; allDay drops the time component.
    const due = isoToLocalDate(entry.date);
    return { ...base, allDay: true, startDate: due, dueDate: due };
  }
  const due = zonedDateTimeToDate(entry.date, entry.time, entry.timeZone);
  return { ...base, allDay: false, startDate: due, dueDate: due, timeZone: entry.timeZone };
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function observeEvent(event: Calendar.ExpoCalendarEvent, timeZone: string): Observation {
  if (event.allDay) {
    const start = toDate(event.startDate);
    return { found: true, date: start ? localDateToISO(start) : null, time: null };
  }
  const end = toDate(event.endDate);
  if (!end) return { found: true, date: null, time: null };
  const zoned = instantToZoned(end, timeZone);
  return { found: true, date: zoned.date, time: zoned.time };
}

function observeReminder(reminder: Calendar.ExpoCalendarReminder, timeZone: string): Observation {
  const due = toDate(reminder.dueDate);
  if (!due) return { found: true, date: null, time: null };
  if (reminder.allDay) return { found: true, date: localDateToISO(due), time: null };
  const zoned = instantToZoned(due, timeZone);
  return { found: true, date: zoned.date, time: zoned.time };
}

async function getEvent(id: string): Promise<Calendar.ExpoCalendarEvent | null> {
  try {
    return await Calendar.ExpoCalendarEvent.get(id);
  } catch {
    return null;
  }
}

async function getReminder(id: string): Promise<Calendar.ExpoCalendarReminder | null> {
  try {
    return await Calendar.ExpoCalendarReminder.get(id);
  } catch {
    return null;
  }
}

/** The Termwise calendar (events) or Reminders list (tasks): the known one, one named "Termwise", or a new one. */
async function ensureContainer(
  kind: ExternalKind,
  knownId: string | null,
): Promise<{ container: Calendar.ExpoCalendar; replaced: boolean }> {
  if (knownId) {
    try {
      const known = await Calendar.ExpoCalendar.get(knownId);
      if (known.allowsModifications) return { container: known, replaced: false };
    } catch {
      // Deleted by the student: find or make another one below.
    }
  }
  const entity = entityFor(kind);
  const existing = (await Calendar.getCalendars(entity)).find(
    (calendar) => calendar.title === CONTAINER_TITLE && calendar.allowsModifications,
  );
  const container =
    existing ?? (await Calendar.createCalendar({ title: CONTAINER_TITLE, color: CONTAINER_COLOR, entityType: entity }));
  return { container, replaced: knownId !== null && container.id !== knownId };
}

function searchWindow(links: readonly LinkState[], today: ISODate): { start: Date; end: Date } {
  const dates = links.map((link) => link.pushed_date).filter((date): date is ISODate => Boolean(date));
  const first = dates.reduce((min, date) => (date < min ? date : min), today);
  const startDate = addDaysSafe(first, -62);
  let endDate = addDaysSafe(dates.reduce((max, date) => (date > max ? date : max), today), 400);
  if (addDaysSafe(startDate, MAX_SEARCH_DAYS) < endDate) endDate = addDaysSafe(startDate, MAX_SEARCH_DAYS);
  return { start: localMidnight(startDate), end: localMidnight(endDate, 23, 59) };
}

/** What the device says about every link of `kind`. Unreadable ids are left out (treated as unknown). */
async function observeLinks(
  kind: ExternalKind,
  container: Calendar.ExpoCalendar,
  links: readonly LinkState[],
  timeZone: string,
  today: ISODate,
): Promise<Map<string, Observation>> {
  const observed = new Map<string, Observation>();
  // Tombstones point at events the student already deleted: nothing to look up.
  const relevant = links.filter((link) => link.external_kind === kind && !link.deleted_externally);
  if (relevant.length === 0) return observed;

  if (kind === 'event') {
    const { start, end } = searchWindow(relevant, today);
    for (const event of await container.listEvents(start, end)) observed.set(event.id, observeEvent(event, timeZone));
  } else {
    for (const reminder of await container.listReminders(null, null, null)) {
      if (reminder.id) observed.set(reminder.id, observeReminder(reminder, timeZone));
    }
  }
  // Not in the listing: moved far away, moved to another calendar, or deleted.
  for (const link of relevant) {
    if (observed.has(link.external_id)) continue;
    if (kind === 'event') {
      const event = await getEvent(link.external_id);
      observed.set(link.external_id, event ? observeEvent(event, timeZone) : { found: false });
    } else {
      const reminder = await getReminder(link.external_id);
      observed.set(link.external_id, reminder ? observeReminder(reminder, timeZone) : { found: false });
    }
  }
  return observed;
}

async function createExternal(kind: ExternalKind, container: Calendar.ExpoCalendar, entry: CalendarEntry): Promise<string> {
  if (kind === 'event') return (await container.createEvent(eventDetails(entry))).id;
  const reminder = await container.createReminder(reminderDetails(entry));
  if (!reminder.id) throw new Error('Reminder was not saved');
  return reminder.id;
}

/** Resolves false when the object no longer exists. */
async function updateExternal(kind: ExternalKind, externalId: string, entry: CalendarEntry): Promise<boolean> {
  if (kind === 'event') {
    const event = await getEvent(externalId);
    if (!event) return false;
    await event.update(eventDetails(entry));
    return true;
  }
  const reminder = await getReminder(externalId);
  if (!reminder) return false;
  await reminder.update(reminderDetails(entry));
  return true;
}

async function removeExternal(kind: ExternalKind, externalId: string): Promise<void> {
  const target = kind === 'event' ? await getEvent(externalId) : await getReminder(externalId);
  if (target) await target.delete();
}

// ---- sync ------------------------------------------------------------------------------------------

export interface AppleSyncResult {
  connectionId: string;
  created: number;
  updated: number;
  deleted: number;
  /** Items whose date the student changed (or deleted) in Calendar / Reminders. */
  externalChanges: number;
  errors: string[];
}

interface SyncSource {
  profile: Profile;
  courses: Course[];
  components: GradingComponent[];
  items: Item[];
  blocks: PlanBlock[];
}

async function loadSource(): Promise<SyncSource> {
  const userId = await requireUserId();
  const [profile, courses, components, items, blocks] = await Promise.all([
    queryClient.fetchQuery(profileQueryOptions(userId)),
    queryClient.fetchQuery(coursesQueryOptions()),
    queryClient.fetchQuery(componentsQueryOptions()),
    queryClient.fetchQuery(itemsQueryOptions()),
    queryClient.fetchQuery(planBlocksQueryOptions()),
  ]);
  if (!profile) throw new AppError('not_found', "We couldn't load your profile. Pull to refresh and try again.");
  return { profile, courses, components, items, blocks };
}

/** Effective weight + high-impact flag per dated item, using the engine's rules. */
function impactLookup(source: SyncSource, today: ISODate): { weights: Map<string, number | null>; highImpact: Set<string> } {
  const settings = plannerSettings(source.profile, today);
  const coursesById = new Map(source.courses.map((course) => [course.id, toEngineCourse(course)]));
  const itemsByCourse = new Map<string, Item[]>();
  for (const item of source.items) {
    const list = itemsByCourse.get(item.course_id) ?? [];
    list.push(item);
    itemsByCourse.set(item.course_id, list);
  }
  const weights = new Map<string, number | null>();
  const highImpact = new Set<string>();
  for (const [courseId, items] of itemsByCourse) {
    const course = coursesById.get(courseId);
    if (!course || course.archived) continue;
    const components = source.components.filter((component) => component.course_id === courseId);
    for (const item of items) {
      if (!item.due_date) continue;
      const impact = computeImpact(item, { course, components, items, settings });
      weights.set(item.id, impact.weight);
      if (impact.isHighImpact) highImpact.add(item.id);
    }
  }
  return { weights, highImpact };
}

function toLinkState(link: CalendarEventLink): LinkState {
  return {
    id: link.id,
    key: link.key,
    external_id: link.external_id,
    external_kind: link.external_kind,
    pushed_hash: link.pushed_hash,
    pushed_date: link.pushed_date,
    deleted_externally: link.deleted_externally ?? false,
  };
}

async function loadConnection(connectionId: string): Promise<CalendarConnection> {
  const connections = await queryClient.fetchQuery({ ...calendarConnectionsQueryOptions(), staleTime: 0 });
  const connection = connections.find((row) => row.id === connectionId);
  if (!connection || connection.provider !== 'apple') {
    throw new AppError('not_found', 'This Apple Calendar connection was removed. Connect it again.');
  }
  return connection;
}

async function saveConnection(id: string, changes: RowPatch<'calendar_connections'>): Promise<void> {
  const saved = unwrap(await supabase.from('calendar_connections').update(changes).eq('id', id).select('*').single());
  upsertInList(queryClient, queryKeys.calendarConnections(), saved);
}

function friendly(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

async function runAppleSync(connectionId: string): Promise<AppleSyncResult> {
  const result: AppleSyncResult = { connectionId, created: 0, updated: 0, deleted: 0, externalChanges: 0, errors: [] };
  const connection = await loadConnection(connectionId);
  const kind = deliveryKind(connection.delivery);

  if (!isAppleCalendarSupported) throw new AppError('bad_request', 'Apple Calendar sync works on iPhone only.');
  const permission = permissionFor(await getApplePermissions(), kind);
  if (permission !== 'granted') {
    const message =
      kind === 'task'
        ? 'Termwise needs access to Reminders. Turn it on in iOS Settings > Termwise.'
        : 'Termwise needs full access to Calendars. Turn it on in iOS Settings > Termwise.';
    await saveConnection(connectionId, { last_error: message }).catch(() => undefined);
    throw new AppError('unauthorized', message);
  }

  try {
    const [source, storedLinks] = await Promise.all([loadSource(), fetchEventLinks(connectionId)]);
    const timeZone = source.profile.timezone;
    const today = todayISO(timeZone);
    let links = storedLinks.map(toLinkState);

    // 1. The Termwise calendar / list, and what is in it now.
    const knownId = kind === 'task' ? connection.task_list_id : connection.external_calendar_id;
    const { container, replaced } = await ensureContainer(kind, knownId);
    const staleLinkIds: string[] = [];
    if (replaced) {
      // The student deleted the whole Termwise calendar: start over instead of reporting every item as deleted.
      staleLinkIds.push(...links.filter((link) => link.external_kind === kind).map((link) => link.id));
      links = links.filter((link) => link.external_kind !== kind);
    }
    const observed = await observeLinks(kind, container, links, timeZone, today);

    // 2. Plan.
    const { weights, highImpact } = impactLookup(source, today);
    const desired: DesiredEntry[] = buildDesiredEntries({
      items: source.items,
      courses: source.courses,
      blocks: source.blocks,
      includeBlocks: connection.sync_plan_blocks,
      today,
      timeZone,
      kind,
      weights,
      highImpactIds: highImpact,
    });
    const pending = new Map<string, PendingChange>();
    const blockedItems = new Set<string>();
    const doneItems = new Set<string>();
    for (const item of source.items) {
      if (item.status === 'done') doneItems.add(item.id);
      if (!item.external_change) continue;
      if (item.external_change.provider === 'apple') pending.set(item.id, item.external_change);
      else blockedItems.add(item.id);
    }
    const plan = planAppleSync({ desired, links, kind, observed, pending, blockedItems, doneItems });

    // 3. Apply on the device.
    const linkWrites: { key: string; external_id: string; pushed_hash: string; pushed_date: ISODate }[] = [];
    const linkDeletes = [...staleLinkIds, ...plan.dropLinks.map((link) => link.id)];
    const pushed = (entry: CalendarEntry, externalId: string, hash: string) =>
      linkWrites.push({ key: entry.key, external_id: externalId, pushed_hash: hash, pushed_date: entry.date });

    for (const { entry, hash } of plan.create) {
      try {
        pushed(entry, await createExternal(kind, container, entry), hash);
        result.created++;
      } catch {
        result.errors.push(`Couldn't add “${entry.title}”.`);
      }
    }
    for (const { desired: target, link } of plan.update) {
      try {
        if (await updateExternal(kind, link.external_id, target.entry)) {
          pushed(target.entry, link.external_id, target.hash);
          result.updated++;
        } else {
          // Deleted on the device after our last look while ours changed: put it back.
          pushed(target.entry, await createExternal(kind, container, target.entry), target.hash);
          result.created++;
        }
      } catch {
        result.errors.push(`Couldn't update “${target.entry.title}”.`);
      }
    }
    for (const link of plan.remove) {
      try {
        await removeExternal(link.external_kind, link.external_id);
        linkDeletes.push(link.id);
        result.deleted++;
      } catch {
        result.errors.push("Couldn't remove an old entry from your calendar.");
      }
    }

    // 4. Changes the student made in Calendar / Reminders, for review in Termwise.
    const detectedAt = new Date().toISOString();
    for (const change of plan.externalChanges) {
      const externalChange: ExternalChange = {
        provider: 'apple',
        new_due_date: change.newDate,
        new_due_time: change.newTime,
        detected_at: detectedAt,
        ...(change.deleted ? { deleted: true } : {}),
      };
      const { error } = await supabase.from('items').update({ external_change: externalChange }).eq('id', change.itemId);
      if (error) result.errors.push("Couldn't save a date change from Apple Calendar.");
      else result.externalChanges++;
    }

    // 5. Bookkeeping: deletes first (a replaced link reuses its key).
    for (const batch of chunk(linkDeletes, LINK_BATCH)) {
      check(await supabase.from('calendar_event_links').delete().eq('connection_id', connectionId).in('id', batch));
    }
    const seenAt = new Date().toISOString();
    for (const batch of chunk(linkWrites, LINK_BATCH)) {
      check(
        await supabase.from('calendar_event_links').upsert(
          batch.map((write) => ({
            connection_id: connectionId,
            key: write.key,
            external_id: write.external_id,
            external_kind: kind,
            pushed_hash: write.pushed_hash,
            pushed_date: write.pushed_date,
            last_seen_at: seenAt,
            deleted_externally: false,
          })),
          { onConflict: 'connection_id,key' },
        ),
      );
    }
    // Deleted on the device: keep the link so the item isn't pushed again (see planAppleSync).
    for (const batch of chunk(plan.tombstones.map((link) => link.id), LINK_BATCH)) {
      check(
        await supabase
          .from('calendar_event_links')
          .update({ deleted_externally: true, last_seen_at: seenAt })
          .eq('connection_id', connectionId)
          .in('id', batch),
      );
    }

    const containerChange =
      kind === 'task' ? { task_list_id: container.id } : { external_calendar_id: container.id };
    await saveConnection(connectionId, {
      ...containerChange,
      status: 'active',
      last_synced_at: new Date().toISOString(),
      last_error: result.errors.length > 0 ? result.errors[0] : null,
    });

    await queryClient.invalidateQueries({ queryKey: queryKeys.eventLinksFor(connectionId) });
    if (result.externalChanges > 0) await queryClient.invalidateQueries({ queryKey: queryKeys.items() });
    return result;
  } catch (error) {
    const message = friendly(error, "Couldn't sync with Apple Calendar. Please try again.");
    await saveConnection(connectionId, { last_error: message }).catch(() => undefined);
    throw toAppError(error instanceof AppError ? error : new AppError('unknown', message, { cause: error }));
  }
}

let activeRun: Promise<AppleSyncResult> | null = null;
let queuedRun: Promise<AppleSyncResult> | null = null;

/**
 * Pushes the plan to this iPhone's Termwise calendar and reads changes back. Calls made while a
 * run is going coalesce into one follow-up run.
 */
export function syncAppleCalendar(connectionId: string): Promise<AppleSyncResult> {
  if (!activeRun) {
    activeRun = runAppleSync(connectionId).finally(() => {
      activeRun = null;
    });
    return activeRun;
  }
  queuedRun ??= activeRun
    .catch(() => undefined)
    .then(() => {
      queuedRun = null;
      return syncAppleCalendar(connectionId);
    });
  return queuedRun;
}

/** Creates (or reuses) this device's connection row, then runs the first sync. */
export async function connectAppleCalendar(options: {
  delivery: CalendarDelivery;
  syncPlanBlocks: boolean;
}): Promise<AppleSyncResult> {
  if (!isAppleCalendarSupported) throw new AppError('bad_request', 'Apple Calendar sync works on iPhone only.');
  const kind = deliveryKind(options.delivery);
  const permission = await requestApplePermission(kind);
  if (permission !== 'granted') {
    throw new AppError(
      'unauthorized',
      kind === 'task'
        ? 'Reminders access is off for Termwise. Turn it on in iOS Settings to continue.'
        : 'Calendar access is off for Termwise. Choose "Full Access" in iOS Settings to continue.',
    );
  }
  const deviceId = await getAppleDeviceId();
  const saved = unwrap(
    await supabase
      .from('calendar_connections')
      .upsert(
        {
          provider: 'apple',
          device_id: deviceId,
          delivery: options.delivery,
          sync_plan_blocks: options.syncPlanBlocks,
          status: 'active',
          last_error: null,
        },
        { onConflict: 'user_id,provider,device_id' },
      )
      .select('*')
      .single(),
  );
  upsertInList(queryClient, queryKeys.calendarConnections(), saved);
  return syncAppleCalendar(saved.id);
}

/**
 * Stops syncing on this device. With `removeFromDevice`, also deletes the Termwise calendar and
 * Reminders list (and everything Termwise put in them) from this iPhone.
 */
export async function disconnectAppleCalendar(connection: CalendarConnection, removeFromDevice: boolean): Promise<void> {
  if (removeFromDevice && isAppleCalendarSupported) {
    const links = await fetchEventLinks(connection.id);
    for (const link of links) {
      try {
        await removeExternal(link.external_kind, link.external_id);
      } catch {
        // Already gone or not accessible; the container delete below catches the rest.
      }
    }
    for (const id of [connection.external_calendar_id, connection.task_list_id]) {
      if (!id) continue;
      try {
        const container = await Calendar.ExpoCalendar.get(id);
        if (container.title === CONTAINER_TITLE && container.allowsModifications) await container.delete();
      } catch {
        // Deleted already, or access was revoked.
      }
    }
  }
  check(await supabase.from('calendar_connections').delete().eq('id', connection.id));
  queryClient.setQueryData<CalendarConnection[]>(queryKeys.calendarConnections(), (current) =>
    current?.filter((row) => row.id !== connection.id),
  );
  queryClient.removeQueries({ queryKey: queryKeys.eventLinksFor(connection.id) });
}

// ---- automatic runs --------------------------------------------------------------------------------

/** Wait after a replan before syncing (several edits in a row settle first). */
const AUTO_DEBOUNCE_MS = 4_000;
/** At most one automatic run per minute. */
const AUTO_MIN_INTERVAL_MS = 60_000;

let autoUsers = 0;
let autoTeardown: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutoRun = 0;

async function runAutoSync(): Promise<void> {
  try {
    const deviceId = await getAppleDeviceId();
    const connections = await queryClient.fetchQuery(calendarConnectionsQueryOptions());
    const connection = connections.find(
      (row) => row.provider === 'apple' && row.device_id === deviceId && row.status === 'active',
    );
    if (!connection) return;
    const permissions = await getApplePermissions();
    if (permissionFor(permissions, deliveryKind(connection.delivery)) !== 'granted') return;
    lastAutoRun = Date.now();
    await syncAppleCalendar(connection.id);
  } catch {
    // Automatic runs are quiet: the error is saved on the connection and shown in Settings.
  }
}

function requestAutoSync(): void {
  const wait = Math.max(AUTO_DEBOUNCE_MS, lastAutoRun + AUTO_MIN_INTERVAL_MS - Date.now());
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void runAutoSync();
  }, wait);
}

function attachAutoSync(): () => void {
  // Every replan rewrites the plan_blocks cache (src/lib/planner.ts persistBlocks).
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryKey[0] === queryKeys.planBlocks()[0]) requestAutoSync();
  });
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') requestAutoSync();
  });
  requestAutoSync();
  return () => {
    unsubscribeCache();
    subscription.remove();
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
  };
}

/**
 * Keeps this iPhone's Apple Calendar in step with the plan (after replans and on foreground,
 * throttled). Safe to mount in several places: one listener runs while any are mounted.
 */
export function useAppleCalendarAutoSync(): void {
  useEffect(() => {
    if (!isAppleCalendarSupported) return;
    autoUsers += 1;
    if (autoUsers === 1) autoTeardown = attachAutoSync();
    return () => {
      autoUsers -= 1;
      if (autoUsers === 0) {
        autoTeardown?.();
        autoTeardown = null;
      }
    };
  }, []);
}

// ---- hooks for screens -----------------------------------------------------------------------------

/** Device-local query keys (not tables): this install's id and its EventKit permissions. */
export const appleQueryKeys = {
  deviceId: ['device', 'appleCalendarDeviceId'] as const,
  permissions: ['device', 'appleCalendarPermissions'] as const,
};

export function useAppleDeviceId() {
  return useQuery({
    queryKey: appleQueryKeys.deviceId,
    queryFn: getAppleDeviceId,
    enabled: isAppleCalendarSupported,
    staleTime: Infinity,
  });
}

/** Calendar + Reminders permission; refreshed whenever the app comes back from iOS Settings. */
export function useApplePermissions() {
  return useQuery({
    queryKey: appleQueryKeys.permissions,
    queryFn: getApplePermissions,
    enabled: isAppleCalendarSupported,
    staleTime: 0,
  });
}

/** This device's Apple connection (null when not connected here) and how many other devices sync. */
export function useAppleConnection() {
  const deviceId = useAppleDeviceId();
  const connections = useCalendarConnections('apple');
  const rows = connections.data ?? [];
  const id = deviceId.data ?? null;
  return {
    connection: id ? (rows.find((row) => row.device_id === id) ?? null) : null,
    otherDevices: rows.filter((row) => row.device_id !== id).length,
    isLoading: connections.isPending || (isAppleCalendarSupported && deviceId.isPending),
    error: connections.error,
    refetch: () => void connections.refetch(),
  };
}

export function useConnectAppleCalendar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: connectAppleCalendar,
    onSettled: () => client.invalidateQueries({ queryKey: appleQueryKeys.permissions }),
  });
}

export function useSyncAppleCalendar() {
  return useMutation({ mutationFn: syncAppleCalendar });
}

export function useDisconnectAppleCalendar() {
  return useMutation({
    mutationFn: ({ connection, removeFromDevice }: { connection: CalendarConnection; removeFromDevice: boolean }) =>
      disconnectAppleCalendar(connection, removeFromDevice),
  });
}

/** Asks for Calendar or Reminders access, then refreshes the permission state. */
export function useRequestApplePermission() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: requestApplePermission,
    onSettled: () => client.invalidateQueries({ queryKey: appleQueryKeys.permissions }),
  });
}
