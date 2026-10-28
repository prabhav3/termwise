// Screen-shaped views over the in-memory plan (usePlan() in src/lib/planner.ts): today's
// checklist, carried-over work, the next red zone, one week in detail, and the master calendar
// grouped by week. Everything here except useRefreshPlan is pure.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  computeDayLoads,
  isMajorKind,
  weeklyStress,
  type AnnotatedItem,
  type CalendarConflict,
  type DayLoad,
  type EngineBlock,
  type EngineCourse,
  type MasterCalendar,
  type MasterCalendarEvent,
  type OverflowWarning,
  type PlanResult,
  type RedZone,
  type TriageAction,
  type WeekStress,
} from '@/engine';
import { addDaysISO, diffDaysISO, isISODateString, startOfWeekISO, type ISODate } from '@/lib/dates';
import { replan, type PlanSnapshot } from '@/lib/planner';

import { invalidateAll } from './helpers';
import { planInputKeys, queryKeys } from './keys';

// ---- shared lookups ----------------------------------------------------------------------------

export function courseIndex(courses: readonly EngineCourse[]): Map<string, EngineCourse> {
  return new Map(courses.map((course) => [course.id, course]));
}

export function itemIndex(items: readonly AnnotatedItem[]): Map<string, AnnotatedItem> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Major kind, `is_major`, or high impact — the deadlines that make a week heavy. */
export function isMajorDeadline(item: Pick<AnnotatedItem, 'kind' | 'is_major' | 'impact'>): boolean {
  return isMajorKind(item.kind) || item.is_major || item.impact.isHighImpact;
}

export function isOpenItem(item: Pick<AnnotatedItem, 'status'>): boolean {
  return item.status === 'todo' || item.status === 'in_progress';
}

/** The Monday a week route is keyed by; null for anything that is not a calendar date. */
export function weekStartFromParam(value: string | string[] | undefined): ISODate | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !isISODateString(raw)) return null;
  return startOfWeekISO(raw);
}

export function weekHref(date: ISODate): `/week/${string}` {
  return `/week/${startOfWeekISO(date)}`;
}

// ---- greeting ------------------------------------------------------------------------------------

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock hour (0–23) in `timeZone` at `now`. */
export function localHour(timeZone: string | null | undefined, now: Date): number {
  const zone = timeZone ?? 'UTC';
  try {
    let formatter = hourFormatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' });
      hourFormatters.set(zone, formatter);
    }
    const hour = Number(formatter.formatToParts(now).find((part) => part.type === 'hour')?.value);
    return Number.isFinite(hour) ? hour % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---- today ---------------------------------------------------------------------------------------

function byPlanOrder(a: EngineBlock, b: EngineBlock): number {
  return a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Every block on `date` (planned, done, missed or skipped) in plan order — milestones first. */
export function blocksForDate(plan: PlanResult, date: ISODate): EngineBlock[] {
  return plan.blocks.filter((block) => block.date === date).sort(byPlanOrder);
}

export interface CarryOver {
  blocks: EngineBlock[];
  minutes: number;
  /** Earliest and latest date of the missed blocks. */
  from: ISODate;
  to: ISODate;
  itemCount: number;
}

/**
 * Work from the last `lookbackDays` that did not get done and still has a future deadline. The
 * engine already folded it back into the remaining plan; this is only for a calm heads-up.
 */
export function carriedOver(plan: PlanResult, today: ISODate, lookbackDays = 7): CarryOver | null {
  const earliest = addDaysISO(today, -lookbackDays);
  const items = itemIndex(plan.annotated);
  const blocks = plan.blocks
    .filter((block) => {
      if (block.status !== 'missed' || block.date >= today || block.date < earliest) return false;
      const item = items.get(block.item_id);
      return item !== undefined && isOpenItem(item) && item.due_date !== null && item.due_date >= today;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byPlanOrder(a, b)));
  if (blocks.length === 0) return null;
  return {
    blocks,
    minutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
    from: blocks[0].date,
    to: blocks[blocks.length - 1].date,
    itemCount: new Set(blocks.map((block) => block.item_id)).size,
  };
}

/** The most pressing deadline cluster starting within `days` (red before orange, then soonest). */
export function upcomingZone(zones: readonly RedZone[], today: ISODate, days = 7): RedZone | null {
  const horizon = addDaysISO(today, days);
  const near = zones.filter((zone) => zone.end >= today && zone.start <= horizon);
  return near.find((zone) => zone.severity === 'red') ?? near[0] ?? null;
}

/** Overflow warnings for open items, soonest deadline first. */
export function sortedOverflow(plan: PlanResult): OverflowWarning[] {
  const items = itemIndex(plan.annotated);
  const due = (warning: OverflowWarning) => items.get(warning.item_id)?.due_date ?? '9999-12-31';
  return plan.overflow
    .filter((warning) => {
      const item = items.get(warning.item_id);
      return item === undefined || isOpenItem(item);
    })
    .sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : b.unplacedMinutes - a.unplacedMinutes));
}

export const TRIAGE_REASON_LABEL: Record<TriageAction['reason'], string> = {
  overdue: 'Overdue',
  due_today: 'Due today',
  due_soon: 'Due soon',
  planned_today: 'On today’s plan',
  high_impact: 'High impact',
  red_zone_prep: 'Red-zone prep',
};

// ---- one week ---------------------------------------------------------------------------------------

export interface DayView {
  date: ISODate;
  load: DayLoad;
  blocks: EngineBlock[];
  /** Items due that day (open ones first). */
  deadlines: AnnotatedItem[];
  isToday: boolean;
  isPast: boolean;
}

export interface WeekView {
  start: ISODate;
  end: ISODate;
  stress: WeekStress;
  days: DayView[];
  /** Highest planned load of the week vs. one day's capacity, for scaling bars. */
  maxDayMinutes: number;
}

export function weekView(snapshot: PlanSnapshot, start: ISODate): WeekView {
  const monday = startOfWeekISO(start);
  const end = addDaysISO(monday, 6);
  const { plan, courses, settings, today } = snapshot;
  const stress =
    snapshot.weekly.find((week) => week.week_start === monday) ?? weeklyStress(plan, courses, settings, monday, 1)[0];
  const active = new Set(courses.filter((course) => !course.archived).map((course) => course.id));
  const loads = computeDayLoads(plan.blocks, settings, monday, end);
  const days = loads.map<DayView>((load) => ({
    date: load.date,
    load,
    blocks: blocksForDate(plan, load.date),
    deadlines: plan.annotated
      .filter((item) => item.due_date === load.date && active.has(item.course_id))
      .sort((a, b) => Number(isOpenItem(b)) - Number(isOpenItem(a)) || b.impact.score - a.impact.score),
    isToday: load.date === today,
    isPast: load.date < today,
  }));
  const maxDayMinutes = Math.max(
    settings.daily_capacity_minutes,
    ...loads.map((load) => load.minutes + load.doneMinutes),
  );
  return { start: monday, end, stress, days, maxDayMinutes };
}

// ---- master calendar --------------------------------------------------------------------------------

export interface CalendarFilters {
  /** Empty = every course. */
  courseIds: readonly string[];
  majorsOnly: boolean;
}

export interface ConflictFlag {
  kind: CalendarConflict['kind'];
  /** Short tag text, e.g. "Same day as 1 other major". */
  label: string;
  /** The engine's full sentence. */
  message: string;
}

export type CalendarRow =
  | { type: 'band'; key: string; event: MasterCalendarEvent; continues: boolean }
  | {
      type: 'item';
      key: string;
      event: MasterCalendarEvent;
      item: AnnotatedItem | undefined;
      major: boolean;
      done: boolean;
      flags: ConflictFlag[];
    }
  | { type: 'empty'; key: string };

export interface CalendarWeek {
  key: string;
  weekStart: ISODate;
  weekEnd: ISODate;
  stress: WeekStress | null;
  isCurrent: boolean;
  isPast: boolean;
  data: CalendarRow[];
}

function flagLabel(conflict: CalendarConflict): string {
  switch (conflict.kind) {
    case 'same_day_majors': {
      const others = Math.max(1, conflict.item_ids.length - 1);
      return `Same day as ${others} other ${others === 1 ? 'major' : 'majors'}`;
    }
    case 'due_on_holiday':
      return 'Due during a break';
    case 'outside_course_dates':
      return 'Outside course dates';
    case 'unscheduled':
      return 'No due date';
  }
}

/** item id -> the dated conflicts that mention it. */
export function conflictFlags(conflicts: readonly CalendarConflict[]): Map<string, ConflictFlag[]> {
  const flags = new Map<string, ConflictFlag[]>();
  for (const conflict of conflicts) {
    if (conflict.kind === 'unscheduled') continue;
    for (const id of conflict.item_ids) {
      const list = flags.get(id) ?? [];
      list.push({ kind: conflict.kind, label: flagLabel(conflict), message: conflict.message });
      flags.set(id, list);
    }
  }
  return flags;
}

export function undatedConflict(master: MasterCalendar): CalendarConflict | null {
  return master.conflicts.find((conflict) => conflict.kind === 'unscheduled') ?? null;
}

export function datedConflicts(master: MasterCalendar): CalendarConflict[] {
  return master.conflicts.filter((conflict) => conflict.kind !== 'unscheduled');
}

function passesCourseFilter(courseId: string | null, filters: CalendarFilters): boolean {
  return filters.courseIds.length === 0 || courseId === null || filters.courseIds.includes(courseId);
}

/**
 * The master calendar grouped by Monday-based week. Weeks with nothing in them are left out,
 * except the current week (so "jump to today" always has somewhere to land). Term events become
 * bands in every week they touch.
 */
export function calendarWeeks(
  master: MasterCalendar,
  annotated: readonly AnnotatedItem[],
  weekly: readonly WeekStress[],
  today: ISODate,
  filters: CalendarFilters,
): CalendarWeek[] {
  const items = itemIndex(annotated);
  const flags = conflictFlags(master.conflicts);
  const thisWeek = startOfWeekISO(today);
  const rowsByWeek = new Map<ISODate, CalendarRow[]>();
  const push = (week: ISODate, row: CalendarRow) => {
    const list = rowsByWeek.get(week);
    if (list) list.push(row);
    else rowsByWeek.set(week, [row]);
  };

  for (const event of master.events) {
    if (!passesCourseFilter(event.course_id, filters)) continue;
    if (event.type === 'term_event') {
      const last = startOfWeekISO(event.end_date);
      for (let week = startOfWeekISO(event.date); week <= last; week = addDaysISO(week, 7)) {
        push(week, { type: 'band', key: `band:${event.id}:${week}`, event, continues: event.date < week });
      }
      continue;
    }
    const item = items.get(event.id);
    const major = item ? isMajorDeadline(item) : event.isHighImpact;
    if (filters.majorsOnly && !major) continue;
    push(startOfWeekISO(event.date), {
      type: 'item',
      key: `item:${event.id}`,
      event,
      item,
      major,
      done: item !== undefined && !isOpenItem(item),
      flags: flags.get(event.id) ?? [],
    });
  }

  if (!rowsByWeek.has(thisWeek)) rowsByWeek.set(thisWeek, [{ type: 'empty', key: `empty:${thisWeek}` }]);

  const stressByWeek = new Map(weekly.map((week) => [week.week_start, week]));
  return [...rowsByWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, rows]) => ({
      key: weekStart,
      weekStart,
      weekEnd: addDaysISO(weekStart, 6),
      stress: stressByWeek.get(weekStart) ?? null,
      isCurrent: weekStart === thisWeek,
      isPast: weekStart < thisWeek,
      data: rows.sort(
        (a, b) =>
          rowDate(a, weekStart).localeCompare(rowDate(b, weekStart)) ||
          (a.type === b.type ? 0 : a.type === 'band' ? -1 : 1),
      ),
    }));
}

function rowDate(row: CalendarRow, weekStart: ISODate): string {
  if (row.type === 'empty') return weekStart;
  return row.type === 'band' && row.continues ? weekStart : row.event.date;
}

/** Days from `today` to `date` (negative in the past). */
export function daysFrom(today: ISODate, date: ISODate): number {
  return diffDaysISO(today, date);
}

// ---- refresh ------------------------------------------------------------------------------------------

/**
 * Pull to refresh: refetch every planner input (so edits made on another device or by a Canvas
 * sync are seen), then rebuild and save the plan.
 */
export function useRefreshPlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await invalidateAll(client, [...planInputKeys, queryKeys.planBlocks()]);
      return replan();
    },
  });
}
