// Planner glue: loads the student's rows, runs the pure engine (src/engine), persists the
// resulting block diff, and reschedules the morning triage notifications.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { coursesQueryOptions } from '@/data/courses';
import { componentsQueryOptions } from '@/data/components';
import { requireUserId, unwrap, check, chunk } from '@/data/helpers';
import { itemsQueryOptions } from '@/data/items';
import { queryKeys } from '@/data/keys';
import { onPlanInputsChanged } from '@/data/plan-signal';
import { planBlocksQueryOptions } from '@/data/planBlocks';
import { profileQueryOptions } from '@/data/profile';
import { termEventsQueryOptions } from '@/data/termEvents';
import { textbooksQueryOptions } from '@/data/textbooks';
import {
  buildPlan,
  detectRedZones,
  rescheduleAfterMiss,
  synthesizeMasterCalendar,
  triageForDate,
  weeklyStress,
  type EngineBlock,
  type EngineCourse,
  type MasterCalendar,
  type PlanInput,
  type PlannerSettings,
  type PlanResult,
  type RedZone,
  type RescheduleResult,
  type TriageAction,
  type WeekStress,
} from '@/engine';
import type { Course, GradingComponent, Item, PlanBlock, Profile, TermEvent, Textbook } from '@/types/db';

import { useAuth } from './auth';
import { addDaysISO, todayISO, zonedDateTimeToDate, type ISODate } from './dates';
import { AppError, toAppError } from './functions';
import { normalizeItemRow, normalizeTextbookRow } from './json-columns';
import { scheduleTriageNotifications } from './notifications';
import { queryClient } from './query-client';
import { readString, storageKeys, writeString } from './storage';
import { supabase } from './supabase';

const STRESS_WEEKS = 16;
const WRITE_BATCH = 500;
/** Several edits in a row (e.g. a review import) collapse into one replan. */
const REPLAN_DEBOUNCE_MS = 800;

const PLAN_FAILED = "We couldn't update your plan just now. Your saved plan is unchanged — try again in a moment.";

// ---- input building (pure) --------------------------------------------------------------

export interface PlannerSource {
  profile: Profile;
  courses: Course[];
  components: GradingComponent[];
  items: Item[];
  textbooks: Textbook[];
  termEvents: TermEvent[];
  blocks: PlanBlock[];
}

export function plannerSettings(profile: Profile, today: ISODate): PlannerSettings {
  return {
    today,
    study_days: profile.study_days,
    daily_capacity_minutes: profile.daily_capacity_minutes,
    reading_pages_per_hour: profile.reading_pages_per_hour,
    default_pages_per_chapter: profile.default_pages_per_chapter,
    // Postgres numeric: normalize in case the driver hands back a string.
    high_impact_threshold: Number(profile.high_impact_threshold),
    blackout_dates: profile.blackout_dates,
  };
}

export function toEngineCourse(course: Course): EngineCourse {
  return { ...course, policies: { ...course.policies } };
}

export function buildPlanInput(source: PlannerSource, today: ISODate): PlanInput {
  return {
    courses: source.courses.map(toEngineCourse),
    components: source.components,
    // Cached rows may come from a write that skipped the read-time reshaping: guard the engine too.
    items: source.items.map(normalizeItemRow),
    textbooks: source.textbooks.map(normalizeTextbookRow),
    termEvents: source.termEvents,
    existingBlocks: source.blocks,
    settings: plannerSettings(source.profile, today),
  };
}

function runEngine<T>(compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    throw new AppError('plan_failed', PLAN_FAILED, { cause: error });
  }
}

// ---- loading & persisting ------------------------------------------------------------------

async function loadSource(): Promise<PlannerSource> {
  const userId = await requireUserId();
  const [profile, courses, components, items, textbooks, termEvents, blocks] = await Promise.all([
    queryClient.fetchQuery(profileQueryOptions(userId)),
    queryClient.fetchQuery(coursesQueryOptions()),
    queryClient.fetchQuery(componentsQueryOptions()),
    queryClient.fetchQuery(itemsQueryOptions()),
    queryClient.fetchQuery(textbooksQueryOptions()),
    queryClient.fetchQuery(termEventsQueryOptions()),
    // The diff must be computed against what is really stored.
    queryClient.fetchQuery({ ...planBlocksQueryOptions(), staleTime: 0 }),
  ]);
  if (!profile) throw new AppError('not_found', "We couldn't load your profile. Pull to refresh and try again.");
  return { profile, courses, components, items, textbooks, termEvents, blocks };
}

type BlockRow = Omit<PlanBlock, 'id' | 'created_at' | 'updated_at'>;

function toRow(userId: string, block: EngineBlock, previous: PlanBlock | undefined): BlockRow {
  return {
    user_id: userId,
    key: block.key,
    item_id: block.item_id,
    course_id: block.course_id,
    date: block.date,
    minutes: Math.round(block.minutes),
    kind: block.kind,
    label: block.label,
    page_start: block.page_start,
    page_end: block.page_end,
    status: block.status,
    sort_order: block.sort_order,
    generated_by: block.generated_by ?? previous?.generated_by ?? 'engine',
    completed_at: previous?.completed_at ?? null,
  };
}

function sameBlock(row: BlockRow, previous: PlanBlock): boolean {
  return (
    row.item_id === previous.item_id &&
    row.course_id === previous.course_id &&
    row.date === previous.date &&
    row.minutes === previous.minutes &&
    row.kind === previous.kind &&
    row.label === previous.label &&
    row.page_start === previous.page_start &&
    row.page_end === previous.page_end &&
    row.status === previous.status &&
    row.sort_order === previous.sort_order &&
    row.generated_by === previous.generated_by
  );
}

function byPlanOrder(a: PlanBlock, b: PlanBlock): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export interface PersistStats {
  upserted: number;
  deleted: number;
}

/**
 * Writes `next` (a PlanResult block set) over `existing`: upserts new or changed blocks by
 * (user_id, key) — which also turns past `planned` blocks the engine returned as `missed` into
 * missed — and deletes engine `planned` blocks dated today or later that the plan dropped.
 */
async function persistBlocks(existing: PlanBlock[], next: EngineBlock[], today: ISODate): Promise<PersistStats> {
  const userId = await requireUserId();
  const previousByKey = new Map(existing.map((block) => [block.key, block]));
  const nextKeys = new Set(next.map((block) => block.key));

  const rows: BlockRow[] = [];
  for (const block of next) {
    if (block.minutes < 0.5) continue; // the table requires minutes > 0
    const previous = previousByKey.get(block.key);
    const row = toRow(userId, block, previous);
    if (!previous || !sameBlock(row, previous)) rows.push(row);
  }
  const stale = existing
    .filter(
      (block) => block.generated_by === 'engine' && block.status === 'planned' && block.date >= today && !nextKeys.has(block.key),
    )
    .map((block) => block.id);

  const saved: PlanBlock[] = [];
  for (const batch of chunk(rows, WRITE_BATCH)) {
    saved.push(...unwrap(await supabase.from('plan_blocks').upsert(batch, { onConflict: 'user_id,key' }).select('*')));
  }
  for (const batch of chunk(stale, WRITE_BATCH)) {
    check(await supabase.from('plan_blocks').delete().in('id', batch));
  }

  const staleIds = new Set(stale);
  const merged = new Map(existing.filter((block) => !staleIds.has(block.id)).map((block) => [block.key, block]));
  for (const block of saved) merged.set(block.key, block);
  queryClient.setQueryData<PlanBlock[]>(queryKeys.planBlocks(), [...merged.values()].sort(byPlanOrder));

  return { upserted: saved.length, deleted: stale.length };
}

async function refreshNotifications(source: PlannerSource, plan: PlanResult, settings: PlannerSettings): Promise<number> {
  return scheduleTriageNotifications({
    plan,
    courses: source.courses.map(toEngineCourse),
    settings,
    profile: source.profile,
  });
}

// ---- replan ----------------------------------------------------------------------------------

export interface ReplanOutcome extends PersistStats {
  today: ISODate;
  plan: PlanResult;
  notificationsScheduled: number;
}

async function runReplan(): Promise<ReplanOutcome> {
  try {
    const source = await loadSource();
    const today = todayISO(source.profile.timezone);
    const input = buildPlanInput(source, today);
    const plan = runEngine(() => buildPlan(input));
    const stats = await persistBlocks(source.blocks, plan.blocks, today);
    const notificationsScheduled = await refreshNotifications(source, plan, input.settings);
    return { ...stats, today, plan, notificationsScheduled };
  } catch (error) {
    throw toAppError(error);
  }
}

/** The tail of the plan_blocks write queue; never rejects. */
let writing: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` after every plan_blocks write queued before it (replans and block status changes),
 * so a replan never saves blocks it loaded before a status change landed. Tasks must not call
 * replan() (it would wait for them): use runReplan() inside.
 */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task);
  writing = run.catch(() => undefined);
  return run;
}

let active: Promise<ReplanOutcome> | null = null;
let queued: Promise<ReplanOutcome> | null = null;

/**
 * Rebuilds and saves the plan. Calls made while one is running coalesce into a single follow-up
 * run (so it always reflects the latest edits) instead of racing each other.
 */
export function replan(): Promise<ReplanOutcome> {
  if (!active) {
    active = exclusive(runReplan).finally(() => {
      active = null;
    });
    return active;
  }
  if (!queued) {
    queued = active
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return replan();
      });
  }
  return queued;
}

export function useReplan() {
  return useMutation({ mutationFn: replan });
}

// ---- block status ---------------------------------------------------------------------------

async function findStoredBlock(key: string): Promise<PlanBlock | null> {
  const cached = queryClient.getQueryData<PlanBlock[]>(queryKeys.planBlocks())?.find((block) => block.key === key);
  if (cached) return cached;
  const fresh = await queryClient.fetchQuery({ ...planBlocksQueryOptions(), staleTime: 0 });
  return fresh.find((block) => block.key === key) ?? null;
}

/**
 * Whether a stored row is the same chunk of work as a block from the in-memory plan. Engine keys
 * are renumbered on every rebuild, so one key can name different pages in memory and in the DB.
 */
export function sameWork(stored: PlanBlock, shown: EngineBlock): boolean {
  return (
    stored.item_id === shown.item_id &&
    stored.date === shown.date &&
    stored.kind === shown.kind &&
    stored.page_start === shown.page_start &&
    stored.page_end === shown.page_end &&
    stored.minutes === Math.round(shown.minutes)
  );
}

/**
 * The stored row for the block on screen (the in-memory plan). When it is missing or holds other
 * work, the saved plan is older than the one shown (not saved yet, or the day rolled over): save
 * the plan first. Call inside exclusive().
 */
async function storedBlockFor(shown: EngineBlock): Promise<PlanBlock> {
  let stored = await findStoredBlock(shown.key);
  if (!stored || !sameWork(stored, shown)) {
    await runReplan();
    stored = await findStoredBlock(shown.key);
  }
  if (!stored) throw new AppError('not_found', 'That block is no longer in your plan. Pull to refresh.');
  if (!sameWork(stored, shown)) throw new AppError('conflict', 'Your plan just changed. Check that block and try again.');
  return stored;
}

/** Marks the block the student saw done, then replans so the remaining work shrinks accordingly. */
export async function markBlockDone(shown: EngineBlock): Promise<ReplanOutcome> {
  try {
    await exclusive(async () => {
      const block = await storedBlockFor(shown);
      const completedAt = new Date().toISOString();
      const saved = unwrap(
        await supabase
          .from('plan_blocks')
          .update({ status: 'done', completed_at: completedAt })
          .eq('id', block.id)
          .select('*')
          .single(),
      );
      queryClient.setQueryData<PlanBlock[]>(queryKeys.planBlocks(), (current) =>
        current?.map((existing) => (existing.id === saved.id ? saved : existing)),
      );
    });
    return await replan();
  } catch (error) {
    throw toAppError(error);
  }
}

export interface MissOutcome {
  /** For a toast: "Moved 40 pages of PSY 101 reading across Wed–Fri". */
  summary: string;
  moved: RescheduleResult['moved'];
  plan: PlanResult;
}

/** Marks the block the student saw missed and spreads its work over the study days left before the deadline. */
export async function markBlockMissed(shown: EngineBlock): Promise<MissOutcome> {
  try {
    // Queued behind any replan in flight, so the reschedule starts from the saved plan.
    return await exclusive(async () => {
      await storedBlockFor(shown);
      const source = await loadSource();
      const today = todayISO(source.profile.timezone);
      const input = buildPlanInput(source, today);
      const result = runEngine(() => rescheduleAfterMiss(input, shown.key));
      await persistBlocks(source.blocks, result.blocks, today);
      await refreshNotifications(source, result, input.settings);
      return { summary: result.summary, moved: result.moved, plan: result };
    });
  } catch (error) {
    throw toAppError(error);
  }
}

export function useMarkBlockDone() {
  return useMutation({ mutationFn: markBlockDone });
}

export function useMarkBlockMissed() {
  return useMutation({ mutationFn: markBlockMissed });
}

// ---- reading the plan in screens ------------------------------------------------------------------

/** The student's local date; rolls over at local midnight and when the app returns to the foreground. */
export function useToday(timeZone: string | null | undefined): ISODate {
  const [today, setToday] = useState(() => todayISO(timeZone));

  useEffect(() => {
    const refresh = () => setToday(todayISO(timeZone));
    refresh();
    const nextMidnight = zonedDateTimeToDate(addDaysISO(todayISO(timeZone), 1), '00:00', timeZone);
    const timer = setTimeout(refresh, Math.max(1_000, nextMidnight.getTime() - Date.now() + 1_000));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [timeZone, today]);

  return today;
}

export interface PlanSnapshot {
  today: ISODate;
  settings: PlannerSettings;
  courses: EngineCourse[];
  plan: PlanResult;
  /** 16 Monday-based weeks starting with this one. */
  weekly: WeekStress[];
  redZones: RedZone[];
  /** Today's top 3. */
  triage: TriageAction[];
  masterCalendar: MasterCalendar;
}

export type PlanView =
  | { status: 'loading' }
  | { status: 'error'; error: AppError; retry: () => void }
  | ({ status: 'ready' } & PlanSnapshot);

/**
 * The plan for screens, computed in memory from the cached rows (deterministic, so it matches
 * what replan() saves) with its derived dashboards. Never throws: engine failures become an
 * error state.
 */
export function usePlan(): PlanView {
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const courses = useQuery(coursesQueryOptions());
  const components = useQuery(componentsQueryOptions());
  const items = useQuery(itemsQueryOptions());
  const textbooks = useQuery(textbooksQueryOptions());
  const termEvents = useQuery(termEventsQueryOptions());
  const blocks = useQuery(planBlocksQueryOptions());
  const queries = [courses, components, items, textbooks, termEvents, blocks];

  const computed = useMemo(() => {
    if (!profile || !courses.data || !components.data || !items.data || !textbooks.data || !termEvents.data || !blocks.data) {
      return null;
    }
    try {
      const source: PlannerSource = {
        profile,
        courses: courses.data,
        components: components.data,
        items: items.data,
        textbooks: textbooks.data,
        termEvents: termEvents.data,
        blocks: blocks.data,
      };
      const input = buildPlanInput(source, today);
      const plan = buildPlan(input);
      const snapshot: PlanSnapshot = {
        today,
        settings: input.settings,
        courses: input.courses,
        plan,
        weekly: weeklyStress(plan, input.courses, input.settings, today, STRESS_WEEKS),
        redZones: detectRedZones(plan.annotated, input.courses, { from: today }),
        triage: triageForDate(plan, input.courses, input.settings, today, 3),
        masterCalendar: synthesizeMasterCalendar(input.courses, plan.annotated, input.termEvents),
      };
      return { ok: true as const, snapshot };
    } catch (error) {
      return { ok: false as const, error: new AppError('plan_failed', PLAN_FAILED, { cause: error }) };
    }
  }, [profile, today, courses.data, components.data, items.data, textbooks.data, termEvents.data, blocks.data]);

  const failed = queries.find((query) => query.error && query.data === undefined);
  const retry = () => {
    for (const query of queries) void query.refetch();
  };
  if (failed?.error) return { status: 'error', error: toAppError(failed.error), retry };
  if (!computed) return { status: 'loading' };
  if (!computed.ok) return { status: 'error', error: computed.error, retry: () => void replan().catch(() => undefined) };
  return { status: 'ready', ...computed.snapshot };
}

// ---- automatic replans -------------------------------------------------------------------------

let dailyCheck: Promise<void> | null = null;

/** Replans once per local day, the first time the app is active that day. */
async function replanIfNewDay(userId: string, timeZone: string): Promise<void> {
  const key = storageKeys.lastReplanDate(userId);
  const today = todayISO(timeZone);
  if ((await readString(key)) === today) return;
  await replan();
  await writeString(key, today);
}

export function useReplanOnForeground(onError?: (error: AppError) => void): void {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const timeZone = profile?.timezone ?? null;

  useEffect(() => {
    if (!userId || !timeZone) return;
    const run = () => {
      if (dailyCheck) return;
      dailyCheck = replanIfNewDay(userId, timeZone)
        .catch((error: unknown) => onError?.(toAppError(error)))
        .finally(() => {
          dailyCheck = null;
        });
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [userId, timeZone, onError]);
}

/** Replans (debounced) whenever a mutation changes items, courses, weights, readings or settings. */
export function useReplanOnInputChanges(onError?: (error: AppError) => void): void {
  const { profile } = useAuth();
  const signedIn = Boolean(profile?.id);

  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onPlanInputsChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        replan().catch((error: unknown) => onError?.(toAppError(error)));
      }, REPLAN_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [signedIn, onError]);
}
