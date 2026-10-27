// Morning triage: the top few concrete actions for a date (docs/ENGINE.md "Triage").
import { addDays, diffDays } from './dates';
import { clamp, courseLabel, formatDayDate, formatMonthDay, formatWeekday, roundTo5 } from './format';
import { studyLabel, timedReadingLabel, workLabel } from './labels';
import { detectRedZones } from './redzone';
import type { AnnotatedItem, EngineBlock, EngineCourse, ISODate, PlannerSettings, PlanResult, TriageAction } from './types';
import { byString, isOpen } from './util';

/**
 * impact × 0.5 + urgency (due today 50, tomorrow 40, in 2 days 30, within 7 days 15)
 * + 60 when overdue + 20 when the item has a planned block that day.
 */
export function itemPriority(item: AnnotatedItem, date: ISODate, hasBlockToday: boolean): number {
  let priority = item.impact.score * 0.5 + (hasBlockToday ? 20 : 0);
  if (item.due_date !== null) {
    const days = diffDays(date, item.due_date);
    if (days < 0) priority += 60;
    else if (days === 0) priority += 50;
    else if (days === 1) priority += 40;
    else if (days === 2) priority += 30;
    else if (days <= 7) priority += 15;
  }
  return priority;
}

function dueText(due: ISODate | null, date: ISODate): string {
  if (due === null) return 'no due date';
  const days = diffDays(date, due);
  if (days < 0) return `was due ${formatDayDate(due)}`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days <= 6) return `due ${formatWeekday(due)}`;
  return `due ${formatMonthDay(due)}`;
}

/** A concrete next step when the day has no block for the item. */
function stepFor(item: AnnotatedItem, reason: TriageAction['reason'], remaining: number): { title: string; minutes: number } {
  const title = item.title;
  const isTest = item.kind === 'exam' || item.kind === 'quiz';
  if (reason === 'overdue' && isTest) return { title: `Mark ${title} as done and add your score`, minutes: 5 };
  const minutes = clamp(roundTo5(remaining), 15, 60);
  switch (reason) {
    case 'overdue':
      return { title: `Finish ${title} — ${minutes} min`, minutes };
    case 'due_today':
      if (isTest) return { title: `Final review for ${title} — ${minutes} min`, minutes };
      if (item.kind === 'reading') return { title: timedReadingLabel(title, minutes), minutes };
      if (item.kind === 'presentation') return { title: `Rehearse ${title} — ${minutes} min`, minutes };
      return { title: `Finish and submit ${title} — ${minutes} min`, minutes };
    case 'red_zone_prep':
      return { title: `Get ahead on ${title} — ${minutes} min`, minutes };
    default:
      if (isTest) return { title: studyLabel(title, minutes), minutes };
      if (item.kind === 'reading') return { title: timedReadingLabel(title, minutes), minutes };
      return { title: workLabel(title, minutes), minutes };
  }
}

/** Top `limit` (default 3) actions for `date` (default settings.today), one per item. */
export function triageForDate(
  plan: PlanResult,
  courses: EngineCourse[],
  settings: PlannerSettings,
  date?: ISODate,
  limit?: number,
): TriageAction[] {
  const day = date ?? settings.today;
  const max = Math.max(0, Math.floor(limit ?? 3));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const blocksToday = new Map<string, EngineBlock[]>();
  const doneMinutes = new Map<string, number>();
  for (const block of plan.blocks) {
    if (block.status === 'done') doneMinutes.set(block.item_id, (doneMinutes.get(block.item_id) ?? 0) + block.minutes);
    if (block.status !== 'planned' || block.date !== day) continue;
    const list = blocksToday.get(block.item_id) ?? [];
    list.push(block);
    blocksToday.set(block.item_id, list);
  }
  for (const list of blocksToday.values()) list.sort((a, b) => a.sort_order - b.sort_order || byString(a.key, b.key));

  const weekOut = addDays(day, 7);
  const redZonePrep = new Set<string>();
  for (const zone of detectRedZones(plan.annotated, courses, { from: day })) {
    if (zone.start > weekOut) continue;
    for (const zoneItem of zone.items) redZonePrep.add(zoneItem.id);
  }

  const ranked: { action: TriageAction; due: ISODate | null; itemTitle: string }[] = [];
  for (const item of plan.annotated) {
    if (!isOpen(item) || courseById.get(item.course_id)?.archived === true) continue;
    const todays = blocksToday.get(item.id) ?? [];
    const dueIn = item.due_date === null ? null : diffDays(day, item.due_date);
    const overdue = dueIn !== null && dueIn < 0;
    const dueSoon = dueIn !== null && dueIn >= 0 && dueIn <= 2;
    const zonePrep = item.impact.isHighImpact && redZonePrep.has(item.id);
    if (todays.length === 0 && !overdue && !dueSoon && !zonePrep) continue;

    const reason: TriageAction['reason'] = overdue
      ? 'overdue'
      : dueIn === 0
        ? 'due_today'
        : dueSoon
          ? 'due_soon'
          : todays.length > 0
            ? item.impact.isHighImpact
              ? 'high_impact'
              : 'planned_today'
            : 'red_zone_prep';
    const block = todays[0];
    const step = block
      ? { title: block.label, minutes: block.minutes }
      : stepFor(item, reason, item.effortMinutes - (doneMinutes.get(item.id) ?? 0));
    const course = courseLabel(courseById.get(item.course_id));
    const subtitle = step.title.includes(item.title)
      ? `${course} · ${dueText(item.due_date, day)}`
      : `${course} · ${item.title} · ${dueText(item.due_date, day)}`;

    ranked.push({
      action: {
        key: `triage:${item.id}:${day}`,
        item_id: item.id,
        block_key: block?.key ?? null,
        course_id: item.course_id,
        title: step.title,
        subtitle,
        minutes: step.minutes,
        priority: itemPriority(item, day, todays.length > 0),
        reason,
      },
      due: item.due_date,
      itemTitle: item.title,
    });
  }

  ranked.sort(
    (a, b) =>
      b.action.priority - a.action.priority ||
      (a.due === null ? 1 : 0) - (b.due === null ? 1 : 0) ||
      byString(a.due ?? '', b.due ?? '') ||
      byString(a.itemTitle, b.itemTitle) ||
      byString(a.action.item_id, b.action.item_id),
  );
  return ranked.slice(0, max).map((entry) => entry.action);
}
