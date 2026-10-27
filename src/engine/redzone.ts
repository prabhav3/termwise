// Red zones (deadline clusters) and the weekly stress score (docs/ENGINE.md).
import { addDays, diffDays, eachDay, startOfWeek } from './dates';
import { courseLabel, formatDayDate, formatHours } from './format';
import { isMajorItem } from './impact';
import { studyDayChecker } from './load';
import type { AnnotatedItem, EngineCourse, ISODate, PlannerSettings, PlanResult, RedZone, StressLevel, WeekStress } from './types';
import { byString, isOpen } from './util';



/** Major kind, `is_major`, or high impact — what counts toward red/orange zones. */
function countsAsMajor(item: AnnotatedItem): boolean {
  return isMajorItem(item) || item.impact.isHighImpact;
}

type DatedItem = AnnotatedItem & { due_date: ISODate };

interface Window {
  start: ISODate;
  end: ISODate;
  severity: 'red' | 'orange';
  items: DatedItem[];
}

function severityOf(items: DatedItem[], minMajor: number): 'red' | 'orange' | null {
  const majors = items.filter(countsAsMajor);
  if (majors.length >= minMajor) return 'red';
  if (majors.length >= 2 && new Set(majors.map((i) => i.course_id)).size >= 2) return 'orange';
  if (items.length >= 4) return 'orange';
  return null;
}

function spanText(start: ISODate, end: ISODate): string {
  const days = diffDays(start, end) + 1;
  if (days === 1) return `on ${formatDayDate(start)}`;
  return days <= 3 ? `in ${days * 24} hours` : `in ${days} days`;
}

function zoneMessage(items: DatedItem[], start: ISODate, end: ISODate, courses: Map<string, EngineCourse>): string {
  const majors = items.filter(countsAsMajor);
  const counted = majors.length >= 2 ? majors : items;
  const labels: string[] = [];
  for (const item of counted) {
    const label = courseLabel(courses.get(item.course_id));
    if (!labels.includes(label)) labels.push(label);
  }
  const where = labels.length > 1 ? `across ${labels.join(', ')}` : `for ${labels[0]}`;
  const when = spanText(start, end);
  if (majors.length >= 2) {
    const extra = items.length >= 4 && items.length > majors.length ? ` (${items.length} deadlines in all)` : '';
    return `${majors.length} major deadlines ${when} ${where}${extra}`;
  }
  return `${items.length} deadlines ${when} ${where}`;
}

export function detectRedZones(
  items: AnnotatedItem[],
  courses: EngineCourse[],
  opts?: { from?: ISODate; windowDays?: number; minMajor?: number },
): RedZone[] {
  // The engine never reads the clock: callers pass `from` (normally settings.today); without it
  // every open dated item is considered.
  const from = opts?.from;
  const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? 2));
  const minMajor = Math.max(1, Math.floor(opts?.minMajor ?? 3));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const considered = items
    .filter((i): i is DatedItem => i.due_date !== null && isOpen(i) && (from === undefined || i.due_date >= from))
    .filter((i) => courseById.get(i.course_id)?.archived !== true)
    .sort((a, b) => byString(a.due_date, b.due_date) || byString(a.title, b.title) || byString(a.id, b.id));

  const windows: Window[] = [];
  const starts = [...new Set(considered.map((i) => i.due_date))];
  for (const start of starts) {
    const end = addDays(start, windowDays - 1);
    const inWindow = considered.filter((i) => i.due_date >= start && i.due_date <= end);
    const severity = severityOf(inWindow, minMajor);
    if (severity) windows.push({ start, end, severity, items: inWindow });
  }

  // Overlapping windows merge into one zone; red wins.
  const merged: Window[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      if (window.end > last.end) last.end = window.end;
      if (window.severity === 'red') last.severity = 'red';
      for (const item of window.items) if (!last.items.some((i) => i.id === item.id)) last.items.push(item);
    } else {
      merged.push({ ...window, items: [...window.items] });
    }
  }

  return merged.map((zone) => {
    const zoneItems = [...zone.items].sort(
      (a, b) => byString(a.due_date, b.due_date) || byString(a.title, b.title) || byString(a.id, b.id),
    );
    const start = zoneItems[0].due_date;
    const end = zoneItems[zoneItems.length - 1].due_date;
    const courseIds: string[] = [];
    for (const item of zoneItems) if (!courseIds.includes(item.course_id)) courseIds.push(item.course_id);
    return {
      start,
      end,
      severity: zone.severity,
      items: zoneItems.map((i) => ({ id: i.id, course_id: i.course_id, title: i.title, kind: i.kind, due_date: i.due_date })),
      courseIds,
      message: zoneMessage(zoneItems, start, end, courseById),
    };
  });
}

export function stressLevel(score: number): StressLevel {
  if (score < 30) return 'calm';
  if (score < 55) return 'busy';
  if (score < 75) return 'heavy';
  return 'red';
}

export function weeklyStress(
  plan: PlanResult,
  courses: EngineCourse[],
  settings: PlannerSettings,
  from: ISODate,
  weeks: number,
): WeekStress[] {
  const first = startOfWeek(from);
  const count = Math.max(0, Math.floor(weeks));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const isStudyDay = studyDayChecker(settings);
  const zones = detectRedZones(plan.annotated, courses, { from: first });
  const items = plan.annotated
    .filter((i): i is DatedItem => i.due_date !== null && isOpen(i) && courseById.get(i.course_id)?.archived !== true)
    .sort((a, b) => b.impact.score - a.impact.score || byString(a.due_date, b.due_date) || byString(a.id, b.id));

  const result: WeekStress[] = [];
  for (let w = 0; w < count; w++) {
    const weekStart = addDays(first, 7 * w);
    const weekEnd = addDays(weekStart, 6);
    const inWeek = (date: ISODate) => date >= weekStart && date <= weekEnd;

    let plannedMinutes = 0;
    for (const block of plan.blocks) if (block.status === 'planned' && inWeek(block.date)) plannedMinutes += block.minutes;
    const capacityMinutes = eachDay(weekStart, weekEnd).filter(isStudyDay).length * settings.daily_capacity_minutes;

    const due = items.filter((i) => inWeek(i.due_date));
    const pointsOf = (i: AnnotatedItem) => (i.impact.isHighImpact ? 3 : isMajorItem(i) ? 2 : 1);
    const deadlinePoints = due.reduce((sum, i) => sum + pointsOf(i), 0);
    const weekZones = zones.filter((z) => z.start <= weekEnd && z.end >= weekStart);
    const hasRed = weekZones.some((z) => z.severity === 'red');
    const hasOrange = weekZones.some((z) => z.severity === 'orange');

    const loadRatio = capacityMinutes > 0 ? Math.min(1, plannedMinutes / capacityMinutes) : plannedMinutes > 0 ? 1 : 0;
    const loadPoints = 35 * loadRatio;
    const score = Math.round(Math.min(100, loadPoints + Math.min(40, 4 * deadlinePoints) + (hasRed ? 25 : hasOrange ? 12 : 0)));

    const drivers: Array<{ text: string; weight: number }> = [];
    for (const zone of weekZones) drivers.push({ text: zone.message, weight: zone.severity === 'red' ? 25 : 12 });
    for (const item of due) {
      drivers.push({ text: `${item.title} (${courseLabel(courseById.get(item.course_id))})`, weight: 4 * pointsOf(item) });
    }
    if (plannedMinutes > 0 && loadRatio >= 0.5) {
      drivers.push({ text: `Planned ${formatHours(plannedMinutes)} vs ${formatHours(capacityMinutes)} free`, weight: loadPoints });
    }
    // Stable sort keeps zone → item (by impact) → load order among equal weights.
    drivers.sort((a, b) => b.weight - a.weight);

    result.push({
      week_start: weekStart,
      week_end: weekEnd,
      score,
      level: hasRed ? 'red' : stressLevel(score),
      deadlines: due.length,
      majorDeadlines: due.filter(countsAsMajor).length,
      plannedMinutes,
      capacityMinutes,
      redZones: weekZones,
      drivers: drivers.slice(0, 3).map((d) => d.text),
    });
  }
  return result;
}
