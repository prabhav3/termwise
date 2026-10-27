// Grade tracking, "what do I need?", and the scenario simulator (docs/ENGINE.md "Grades").
import { formatPercent } from './format';
import type {
  ComponentGrade,
  CourseGrade,
  EngineComponent,
  EngineCourse,
  EngineItem,
  GradeCutoff,
  OtherWorkAssumption,
  RequiredScore,
} from './types';
import { byString } from './util';

export const DEFAULT_GRADE_SCALE: GradeCutoff[] = [
  { letter: 'A', min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B', min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C', min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D', min: 63 },
  { letter: 'D-', min: 60 },
  { letter: 'F', min: 0 },
];

const EPSILON = 1e-9;

export function letterFor(percent: number | null, scale: GradeCutoff[]): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const cutoffs = [...(scale.length > 0 ? scale : DEFAULT_GRADE_SCALE)].sort((a, b) => b.min - a.min);
  for (const cutoff of cutoffs) if (percent + EPSILON >= cutoff.min) return cutoff.letter;
  return null;
}

export function itemPercent(item: Pick<EngineItem, 'score' | 'points_possible'>): number | null {
  if (item.score === null) return null;
  if (item.points_possible === null) return item.score;
  // Zero-point (extra-credit) items have no meaningful percent of their own.
  return item.points_possible > 0 ? (item.score / item.points_possible) * 100 : null;
}

// ---- grade model -------------------------------------------------------------------------

interface Entry {
  id: string;
  score: number | null;
  points: number | null;
}

interface Group {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  entries: Entry[];
  /** max(expected_count, linked items): the slots this category will eventually have. */
  slots: number;
}

function scaleFor(course: EngineCourse): GradeCutoff[] {
  return course.grade_scale.length > 0 ? course.grade_scale : DEFAULT_GRADE_SCALE;
}

function toEntry(item: EngineItem): Entry {
  return { id: item.id, score: item.score, points: item.points_possible };
}

/** Components of the course plus standalone items (weight_override, no component) as their own groups. */
function buildGroups(course: EngineCourse, components: EngineComponent[], items: EngineItem[]): Group[] {
  const own = components.filter((c) => c.course_id === course.id);
  const known = new Set(own.map((c) => c.id));
  const courseItems = items.filter((i) => i.course_id === course.id);
  const groups: Group[] = own.map((component) => {
    const entries = courseItems.filter((i) => i.component_id === component.id).map(toEntry);
    return {
      id: component.id,
      name: component.name,
      weight: Math.max(0, component.weight),
      dropLowest: Math.max(0, Math.floor(component.drop_lowest)),
      entries,
      slots: Math.max(component.expected_count ?? 0, entries.length),
    };
  });
  for (const item of courseItems) {
    const unlinked = item.component_id === null || !known.has(item.component_id);
    if (unlinked && item.weight_override !== null) {
      groups.push({ id: item.id, name: item.title, weight: Math.max(0, item.weight_override), dropLowest: 0, entries: [toEntry(item)], slots: 1 });
    }
  }
  return groups;
}

/** Ordering value for drop-lowest (zero-point extra credit is never dropped). */
function rankValue(entry: Entry): number {
  if (entry.points === 0) return Number.POSITIVE_INFINITY;
  return itemPercent({ score: entry.score, points_possible: entry.points }) ?? Number.POSITIVE_INFINITY;
}

/**
 * Percent over graded entries after dropping the `dropLowest` lowest (only while more than
 * `dropLowest` are graded). Points-based when every graded entry has points, else mean percent.
 */
function groupPercent(entries: Entry[], dropLowest: number): { percent: number | null; dropped: string[]; graded: number } {
  const graded = entries.filter((e) => e.score !== null);
  if (graded.length === 0) return { percent: null, dropped: [], graded: 0 };
  const drop = graded.length > dropLowest ? dropLowest : 0;
  const ranked = [...graded].sort((a, b) => rankValue(a) - rankValue(b) || byString(a.id, b.id));
  const dropped = ranked.slice(0, drop);
  const counted = ranked.slice(drop);

  const totalPoints = counted.reduce((sum, e) => sum + (e.points ?? 0), 0);
  if (graded.every((e) => e.points !== null) && totalPoints > 0) {
    const earned = counted.reduce((sum, e) => sum + (e.score ?? 0), 0);
    return { percent: (earned / totalPoints) * 100, dropped: dropped.map((e) => e.id), graded: graded.length };
  }
  const percents = counted
    .map((e) => itemPercent({ score: e.score, points_possible: e.points }))
    .filter((p): p is number => p !== null);
  const percent = percents.length > 0 ? percents.reduce((a, b) => a + b, 0) / percents.length : null;
  return { percent, dropped: dropped.map((e) => e.id), graded: graded.length };
}

function withPercent(entry: Entry, percent: number): Entry {
  if (entry.points !== null && entry.points > 0) return { ...entry, score: (percent / 100) * entry.points };
  if (entry.points === 0) return { ...entry, score: 0 };
  return { ...entry, score: percent };
}

/**
 * Final course percent once everything is graded. Ungraded entries (and the `override` entry,
 * even if graded) take `valueFor`; categories with fewer listed items than slots get placeholder
 * entries, and an empty weighted category counts as one placeholder.
 */
function finalPercent(groups: Group[], valueFor: (group: Group, entryId: string | null) => number, override: string | null = null): number | null {
  let sum = 0;
  let weight = 0;
  for (const group of groups) {
    if (group.weight <= 0) continue;
    const entries = group.entries.map((e) => (e.score === null || e.id === override ? withPercent(e, valueFor(group, e.id)) : e));
    const placeholders = Math.max(group.slots - group.entries.length, group.entries.length === 0 ? 1 : 0);
    const knownPoints = group.entries.map((e) => e.points);
    const placeholderPoints =
      knownPoints.length > 0 && knownPoints.every((p): p is number => p !== null && p > 0)
        ? knownPoints.reduce((a, b) => a + b, 0) / knownPoints.length
        : null;
    for (let n = 0; n < placeholders; n++) {
      entries.push(withPercent({ id: `${group.id}#${n}`, score: null, points: placeholderPoints }, valueFor(group, null)));
    }
    const { percent } = groupPercent(entries, group.dropLowest);
    if (percent === null) continue;
    sum += group.weight * percent;
    weight += group.weight;
  }
  return weight > 0 ? sum / weight : null;
}

/** Courses with no weights at all fall back to plain points (or mean percent) over graded items. */
function unweightedPercent(course: EngineCourse, items: EngineItem[]): number | null {
  const graded = items.filter((i) => i.course_id === course.id).map(toEntry);
  return groupPercent(graded, 0).percent;
}

export function courseGrade(course: EngineCourse, components: EngineComponent[], items: EngineItem[]): CourseGrade {
  const groups = buildGroups(course, components, items);
  const grades: ComponentGrade[] = groups.map((group) => {
    const { percent, dropped, graded } = groupPercent(group.entries, group.dropLowest);
    return {
      component_id: group.id,
      name: group.name,
      weight: group.weight,
      percent,
      gradedCount: graded,
      totalCount: group.slots,
      droppedItemIds: dropped,
    };
  });
  const weighted = grades.filter((g) => g.weight > 0);
  const totalWeight = weighted.reduce((sum, g) => sum + g.weight, 0);
  const graded = weighted.filter((g) => g.percent !== null);
  const gradedWeight = graded.reduce((sum, g) => sum + g.weight, 0);

  let percent: number | null;
  if (gradedWeight > 0) percent = graded.reduce((sum, g) => sum + g.weight * (g.percent ?? 0), 0) / gradedWeight;
  else percent = totalWeight === 0 ? unweightedPercent(course, items) : null;

  return {
    percent,
    letter: letterFor(percent, scaleFor(course)),
    gradedWeight,
    totalWeight,
    projectedMin: totalWeight > 0 ? finalPercent(groups, () => 0) : null,
    projectedMax: totalWeight > 0 ? finalPercent(groups, () => 100) : null,
    components: grades,
  };
}

// ---- what do I need? ----------------------------------------------------------------------

function assumptionPhrase(assume: OtherWorkAssumption): string {
  switch (assume) {
    case 'zero':
      return ", assuming a 0 on everything else that's still ungraded";
    case 'perfect':
      return ', assuming full marks on everything else';
    default:
      return ', assuming you keep your current average on everything else';
  }
}

/** "What do I need on the final?" */
export function requiredScore(
  course: EngineCourse,
  components: EngineComponent[],
  items: EngineItem[],
  itemId: string,
  targetPercent: number,
  assumeOthers: OtherWorkAssumption = 'current_average',
): RequiredScore {
  const base = { item_id: itemId, targetPercent };
  const target = items.find((i) => i.id === itemId && i.course_id === course.id);
  if (!target) {
    return { ...base, neededPercent: null, achievable: false, alreadySecured: false, explanation: "Couldn't find that assignment in this course." };
  }
  const groups = buildGroups(course, components, items);
  const holder = groups.find((g) => g.entries.some((e) => e.id === itemId));
  if (groups.every((g) => g.weight <= 0)) {
    return { ...base, neededPercent: null, achievable: false, alreadySecured: false, explanation: 'Add grading weights for this course to see what you need.' };
  }
  if (!holder || holder.weight <= 0) {
    return {
      ...base,
      neededPercent: null,
      achievable: false,
      alreadySecured: false,
      explanation: `${target.title} isn't linked to a weighted grade category, so it can't change your grade as entered.`,
    };
  }

  // Current averages without the target's own score, so a what-if never counts itself.
  const without = items.map((i) => (i.id === itemId ? { ...i, score: null } : i));
  const current = courseGrade(course, components, without);
  const averages = new Map(current.components.map((c) => [c.component_id, c.percent]));
  const hasOtherOpenWork = groups.some(
    (g) => g.weight > 0 && (g.slots > g.entries.length || g.entries.length === 0 || g.entries.some((e) => e.id !== itemId && e.score === null)),
  );

  const finalWith = (x: number): number =>
    finalPercent(
      groups,
      (group, entryId) => {
        if (entryId === itemId) return x;
        if (assumeOthers === 'zero') return 0;
        if (assumeOthers === 'perfect') return 100;
        return averages.get(group.id) ?? current.percent ?? x;
      },
      itemId,
    ) ?? 0;

  const goal = `${formatPercent(targetPercent)}${letterSuffix(targetPercent, course)}`;
  const assumption = hasOtherOpenWork ? assumptionPhrase(assumeOthers) : '';
  const atZero = finalWith(0);
  if (atZero >= targetPercent - EPSILON) {
    return {
      ...base,
      neededPercent: 0,
      achievable: true,
      alreadySecured: true,
      explanation: `You've already secured ${goal} — even a 0 on ${target.title} keeps you there${assumption}.`,
    };
  }

  const atPerfect = finalWith(100);
  const atMax = finalWith(200);
  let needed: number;
  if (atMax < targetPercent - EPSILON) {
    const slope = (atMax - atPerfect) / 100;
    if (slope <= EPSILON) {
      return {
        ...base,
        neededPercent: null,
        achievable: false,
        alreadySecured: false,
        explanation: `No score on ${target.title} gets you to ${goal} — a perfect score gets you about ${formatPercent(atPerfect)}${assumption}.`,
      };
    }
    needed = 200 + (targetPercent - atMax) / slope;
  } else {
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (finalWith(mid) >= targetPercent - EPSILON) hi = mid;
      else lo = mid;
    }
    needed = hi;
  }
  needed = Math.ceil(needed * 10 - 1e-6) / 10;

  if (needed <= 100 + EPSILON) {
    return {
      ...base,
      neededPercent: needed,
      achievable: true,
      alreadySecured: false,
      explanation: `You need at least ${formatPercent(needed)} on ${target.title} to finish with ${goal}${assumption}.`,
    };
  }
  return {
    ...base,
    neededPercent: needed,
    achievable: false,
    alreadySecured: false,
    explanation: `You'd need ${formatPercent(needed)} on ${target.title} to reach ${goal}, which is more than full marks — a perfect score gets you about ${formatPercent(atPerfect)}${assumption}.`,
  };
}

function letterSuffix(percent: number, course: EngineCourse): string {
  const letter = letterFor(percent, scaleFor(course));
  return letter ? ` (${letter})` : '';
}

export function simulateGrade(
  course: EngineCourse,
  components: EngineComponent[],
  items: EngineItem[],
  hypothetical: Record<string, number>,
): CourseGrade {
  const applied = items.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(hypothetical, item.id)) return item;
    const percent = hypothetical[item.id];
    if (!Number.isFinite(percent)) return item;
    const score = item.points_possible !== null && item.points_possible > 0 ? (percent / 100) * item.points_possible : percent;
    return { ...item, score };
  });
  return courseGrade(course, components, applied);
}
