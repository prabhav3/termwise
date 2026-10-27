// Focus sessions (docs/ENGINE.md "Pomodoro").
import type { EngineCourse, EngineItem, FocusTask, ISODate, PlanResult, PomodoroSegment } from './types';
import { itemPriority } from './triage';
import { byString } from './util';

/** Longest session pomodoroCycles will lay out (guards against runaway input). */
const MAX_SESSION_MINUTES = 24 * 60;

/** "Study 25 mins for PSY 101 Quiz 1" */
export function focusLabel(
  item: Pick<EngineItem, 'title'>,
  course: Pick<EngineCourse, 'code' | 'title'> | undefined,
  minutes: number,
): string {
  const courseName = course?.code?.trim() || course?.title?.trim() || '';
  const subject = courseName ? `${courseName} ${item.title}` : item.title;
  return `Study ${minutes} ${minutes === 1 ? 'min' : 'mins'} for ${subject}`;
}

/** The date's planned blocks in triage-priority order, each capped at one focus session. */
export function focusQueue(plan: PlanResult, courses: EngineCourse[], date: ISODate, focusMinutes: number): FocusTask[] {
  const items = new Map(plan.annotated.map((i) => [i.id, i]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const ranked = plan.blocks
    .filter((b) => b.status === 'planned' && b.date === date)
    .map((block) => {
      const item = items.get(block.item_id);
      return { block, item, priority: item ? itemPriority(item, date, true) : 0 };
    })
    .sort((a, b) => b.priority - a.priority || a.block.sort_order - b.block.sort_order || byString(a.block.key, b.block.key));
  return ranked.map(({ block, item }) => {
    const minutes = focusMinutes > 0 ? Math.min(block.minutes, focusMinutes) : block.minutes;
    return {
      block_key: block.key,
      item_id: block.item_id,
      course_id: block.course_id,
      label: focusLabel(item ?? { title: block.label }, courseById.get(block.course_id), minutes),
      minutes,
    };
  });
}

/**
 * Focus segments until `totalMinutes` of focus is covered (the last may be shorter), a break
 * between segments (long after every `longEvery`-th focus), never a trailing break.
 */
export function pomodoroCycles(
  totalMinutes: number,
  focusMinutes = 25,
  shortBreakMinutes = 5,
  longBreakMinutes = 15,
  longEvery = 4,
): PomodoroSegment[] {
  const segments: PomodoroSegment[] = [];
  if (!(totalMinutes > 0)) return segments;
  const focus = focusMinutes > 0 ? focusMinutes : totalMinutes;
  const every = Math.max(1, Math.floor(longEvery));
  let left = Math.min(totalMinutes, MAX_SESSION_MINUTES);
  let count = 0;
  while (left > 0) {
    const minutes = Math.min(focus, left);
    segments.push({ kind: 'focus', minutes });
    left -= minutes;
    count += 1;
    if (left <= 0) break;
    const long = count % every === 0;
    const breakMinutes = long ? longBreakMinutes : shortBreakMinutes;
    if (breakMinutes > 0) segments.push({ kind: long ? 'long_break' : 'short_break', minutes: breakMinutes });
  }
  return segments;
}
