// Whole-year synthesis: deduped term events and a master calendar with conflict checks.
import { addDays, isISODate, maxDate, minDate } from './dates';
import { countNoun, courseLabel, formatDayDate, formatMonthDay } from './format';
import { isMajorItem } from './impact';
import type { AnnotatedItem, CalendarConflict, EngineCourse, EngineTermEvent, MasterCalendar, MasterCalendarEvent } from './types';
import { byString, isOpen } from './util';

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same words, or one title's words appear as a whole-word run inside the other's. */
function similarTitles(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (x === y) return true;
  if (x.length === 0 || y.length === 0) return false;
  return ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/** Overlapping or adjacent (one day apart) date ranges. */
function touches(a: EngineTermEvent, b: EngineTermEvent): boolean {
  return b.start_date <= addDays(a.end_date, 1) && a.start_date <= addDays(b.end_date, 1);
}

function compareEvents(a: EngineTermEvent, b: EngineTermEvent): number {
  return byString(a.start_date, b.start_date) || byString(a.end_date, b.end_date) || byString(a.title, b.title) || byString(a.id, b.id);
}

function combine(a: EngineTermEvent, b: EngineTermEvent): EngineTermEvent {
  // Keep the earlier event's id; the more descriptive (longer) title wins.
  const title = b.title.trim().length > a.title.trim().length ? b.title : a.title;
  return {
    ...a,
    title,
    start_date: minDate(a.start_date, b.start_date) ?? a.start_date,
    end_date: maxDate(a.end_date, b.end_date) ?? a.end_date,
    course_id: a.course_id === b.course_id ? a.course_id : null,
  };
}

export function mergeTermEvents(events: EngineTermEvent[]): EngineTermEvent[] {
  const list = events
    .filter((e) => isISODate(e.start_date) && isISODate(e.end_date))
    .map((e) => (e.end_date < e.start_date ? { ...e, start_date: e.end_date, end_date: e.start_date } : { ...e }))
    .sort(compareEvents);
  // Repeat until stable so chains (A~B, B~C) collapse into one event.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.kind === b.kind && touches(a, b) && similarTitles(a.title, b.title)) {
          list[i] = combine(a, b);
          list.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return list.sort(compareEvents);
}

function itemRef(item: AnnotatedItem, courses: Map<string, EngineCourse>): string {
  return `${courseLabel(courses.get(item.course_id))} ${item.title}`;
}

function rangeText(start: string, end: string): string {
  return start === end ? formatMonthDay(start) : `${formatMonthDay(start)}–${formatMonthDay(end)}`;
}

const CONFLICT_ORDER: Record<CalendarConflict['kind'], number> = {
  same_day_majors: 0,
  due_on_holiday: 1,
  outside_course_dates: 2,
  unscheduled: 3,
};

export function synthesizeMasterCalendar(
  courses: EngineCourse[],
  items: AnnotatedItem[],
  termEvents: EngineTermEvent[],
): MasterCalendar {
  const active = new Map(courses.filter((c) => !c.archived).map((c) => [c.id, c]));
  const courseItems = items.filter((i) => active.has(i.course_id));
  const merged = mergeTermEvents(termEvents.filter((e) => e.course_id === null || active.has(e.course_id)));

  const events: MasterCalendarEvent[] = [];
  for (const item of courseItems) {
    if (item.due_date === null || !isISODate(item.due_date)) continue;
    events.push({
      date: item.due_date,
      end_date: item.due_date,
      type: 'item',
      id: item.id,
      course_id: item.course_id,
      title: item.title,
      kind: item.kind,
      isHighImpact: item.impact.isHighImpact,
    });
  }
  for (const event of merged) {
    events.push({
      date: event.start_date,
      end_date: event.end_date,
      type: 'term_event',
      id: event.id,
      course_id: event.course_id,
      title: event.title,
      kind: event.kind,
      isHighImpact: false,
    });
  }
  // Term events first on a shared date so breaks frame that day's deadlines.
  events.sort(
    (a, b) =>
      byString(a.date, b.date) ||
      (a.type === b.type ? 0 : a.type === 'term_event' ? -1 : 1) ||
      byString(a.title, b.title) ||
      byString(a.id, b.id),
  );

  const conflicts: CalendarConflict[] = [];
  const open = courseItems.filter(isOpen);

  const majorsByDate = new Map<string, AnnotatedItem[]>();
  for (const item of open) {
    if (item.due_date === null || !(isMajorItem(item) || item.impact.isHighImpact)) continue;
    const list = majorsByDate.get(item.due_date) ?? [];
    list.push(item);
    majorsByDate.set(item.due_date, list);
  }
  for (const [date, list] of majorsByDate) {
    if (new Set(list.map((i) => i.course_id)).size < 2) continue;
    const sorted = [...list].sort((a, b) => byString(a.title, b.title) || byString(a.id, b.id));
    conflicts.push({
      kind: 'same_day_majors',
      date,
      item_ids: sorted.map((i) => i.id),
      message: `${sorted.length} major deadlines on ${formatDayDate(date)}: ${sorted.map((i) => itemRef(i, active)).join(', ')}`,
    });
  }

  const breaks = merged.filter((e) => e.kind === 'holiday' || e.kind === 'break');
  for (const item of open) {
    const due = item.due_date;
    if (due === null) continue;
    const holiday = breaks.find((e) => due >= e.start_date && due <= e.end_date);
    if (holiday) {
      conflicts.push({
        kind: 'due_on_holiday',
        date: due,
        item_ids: [item.id],
        message: `${itemRef(item, active)} is due during ${holiday.title} (${rangeText(holiday.start_date, holiday.end_date)}) — worth double-checking the date.`,
      });
    }
    const course = active.get(item.course_id);
    if (course?.start_date && due < course.start_date) {
      conflicts.push({
        kind: 'outside_course_dates',
        date: due,
        item_ids: [item.id],
        message: `${itemRef(item, active)} is due ${formatMonthDay(due)}, before ${courseLabel(course)} starts (${formatMonthDay(course.start_date)}).`,
      });
    } else if (course?.end_date && due > course.end_date) {
      conflicts.push({
        kind: 'outside_course_dates',
        date: due,
        item_ids: [item.id],
        message: `${itemRef(item, active)} is due ${formatMonthDay(due)}, after ${courseLabel(course)} ends (${formatMonthDay(course.end_date)}).`,
      });
    }
  }

  const undated = open.filter((i) => i.due_date === null).sort((a, b) => byString(a.title, b.title) || byString(a.id, b.id));
  if (undated.length > 0) {
    const names = undated.slice(0, 3).map((i) => itemRef(i, active));
    const more = undated.length > 3 ? ` and ${undated.length - 3} more` : '';
    conflicts.push({
      kind: 'unscheduled',
      date: null,
      item_ids: undated.map((i) => i.id),
      message: `${countNoun(undated.length, 'item')} ${undated.length === 1 ? 'has' : 'have'} no due date yet: ${names.join(', ')}${more}`,
    });
  }

  conflicts.sort(
    (a, b) =>
      (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) ||
      byString(a.date ?? '', b.date ?? '') ||
      CONFLICT_ORDER[a.kind] - CONFLICT_ORDER[b.kind] ||
      byString(a.message, b.message),
  );

  const activeCourses = [...active.values()];
  return {
    start: minDate(...events.map((e) => e.date), ...activeCourses.map((c) => c.start_date)),
    end: maxDate(...events.map((e) => e.end_date), ...activeCourses.map((c) => c.end_date)),
    events,
    termEvents: merged,
    conflicts,
  };
}
