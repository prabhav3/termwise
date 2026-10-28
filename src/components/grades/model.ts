// Pure view-model helpers for the grade tracker, "What do I need?" and the scenario simulator.
// No React, no Supabase: the grade math itself lives in src/engine (courseGrade, requiredScore,
// simulateGrade, letterFor, itemPercent); this file only decides what to show and how to say it.
import {
  DEFAULT_GRADE_SCALE,
  effectiveWeight,
  isMajorKind,
  itemPercent,
  letterFor,
  type CourseGrade,
  type EngineComponent,
  type EngineCourse,
  type EngineItem,
  type GradeCutoff,
  type RequiredScore,
} from '@/engine';
import { normalizeCourseRow } from '@/lib/json-columns';
import type { Course } from '@/types/db';

/** Weights within this many points of 100 count as "adding up". */
const WEIGHT_TOLERANCE = 0.5;
/** Needing at most this much on the target item reads as comfortably within reach. */
const WITHIN_REACH_MAX = 80;
/** Upper bound for typed percents (extra credit can push an item past 100). */
export const MAX_ENTRY_PERCENT = 150;

// ---- course & scale ---------------------------------------------------------------------

/** DB course row -> engine course (policies gets an index signature). */
export function toGradeCourse(course: Course): EngineCourse {
  // A malformed grade_scale must not crash the tracker or "What do I need?".
  const normalized = normalizeCourseRow(course);
  return { ...normalized, policies: { ...normalized.policies } };
}

/** The course's letter scale, highest cutoff first (default scale when the course has none). */
export function sortedScale(course: Pick<EngineCourse, 'grade_scale'>): GradeCutoff[] {
  const scale = course.grade_scale.length > 0 ? course.grade_scale : DEFAULT_GRADE_SCALE;
  return scale
    .map((cutoff) => ({ letter: cutoff.letter, min: Number(cutoff.min) }))
    .filter((cutoff) => cutoff.letter.trim().length > 0 && Number.isFinite(cutoff.min))
    .sort((a, b) => b.min - a.min);
}

/** Letter cutoffs worth aiming for (an F cutoff at 0 is never a target). */
export function targetCutoffs(course: Pick<EngineCourse, 'grade_scale'>): GradeCutoff[] {
  return sortedScale(course).filter((cutoff) => cutoff.min > 0);
}

export function letterForCourse(percent: number | null, course: Pick<EngineCourse, 'grade_scale'>): string | null {
  return letterFor(percent, sortedScale(course));
}

// ---- formatting --------------------------------------------------------------------------

function oneDecimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

/**
 * A grade you have, e.g. "87.4%". Rounds down to 0.1 so the number never shows a higher
 * letter than the one you hold (92.96% reads "92.9%", an A-).
 */
export function formatGrade(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  return `${oneDecimal(Math.floor(percent * 10 + 1e-9) / 10)}%`;
}

/** A percent you need, e.g. "78.5%". Rounds up so you never aim too low. */
export function formatNeeded(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  return `${oneDecimal(Math.ceil(percent * 10 - 1e-9) / 10)}%`;
}

/** A weight or plain percent, e.g. "25%", "12.5%". */
export function formatWeight(percent: number): string {
  return `${oneDecimal(Math.round(percent * 10) / 10)}%`;
}

/** Score as a short string: "18.5" (no trailing zeros, at most 2 decimals). */
export function formatScoreNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded);
}

export interface ScoreSummary {
  /** "18 / 20 · 90%", "90%", "+2 extra credit"; null when ungraded. */
  text: string | null;
  /** Spoken version, e.g. "18 out of 20, 90 percent". */
  spoken: string | null;
  percent: number | null;
}

export function describeScore(item: Pick<EngineItem, 'score' | 'points_possible'>): ScoreSummary {
  if (item.score === null) return { text: null, spoken: null, percent: null };
  const percent = itemPercent(item);
  const score = formatScoreNumber(item.score);
  if (item.points_possible === null) {
    return { text: formatGrade(percent), spoken: `${formatGrade(percent).replace('%', ' percent')}`, percent };
  }
  if (item.points_possible === 0) {
    return { text: `+${score} extra credit`, spoken: `${score} points of extra credit`, percent: null };
  }
  const points = formatScoreNumber(item.points_possible);
  const pct = formatGrade(percent);
  return {
    text: `${score} / ${points} · ${pct}`,
    spoken: `${score} out of ${points}, ${pct.replace('%', ' percent')}`,
    percent,
  };
}

// ---- weights ------------------------------------------------------------------------------

export type WeightCheck =
  | { kind: 'none' }
  | { kind: 'ok'; total: number }
  | { kind: 'under' | 'over'; total: number };

export function checkWeights(grade: Pick<CourseGrade, 'totalWeight'>): WeightCheck {
  const total = grade.totalWeight;
  if (!(total > 0)) return { kind: 'none' };
  if (Math.abs(total - 100) <= WEIGHT_TOLERANCE) return { kind: 'ok', total };
  return { kind: total < 100 ? 'under' : 'over', total };
}

/** Share of the course grade that has at least one score in it (0..1). */
export function gradedShare(grade: Pick<CourseGrade, 'gradedWeight' | 'totalWeight'>): number {
  if (!(grade.totalWeight > 0)) return 0;
  return Math.min(1, Math.max(0, grade.gradedWeight / grade.totalWeight));
}

/** "62% of the grade is in" */
export function gradedShareLabel(grade: Pick<CourseGrade, 'gradedWeight' | 'totalWeight'>): string {
  if (!(grade.totalWeight > 0)) return 'No grading weights yet';
  const share = Math.round(gradedShare(grade) * 100);
  if (share === 0) return 'No scores in yet';
  if (share === 100) return 'All of the grade is in';
  return `${share}% of the grade is in`;
}

// ---- grouping ----------------------------------------------------------------------------

/** Items that can carry a score: anything graded, weighted or linked — not plain readings. */
export function isGradeable(item: EngineItem, componentIds: ReadonlySet<string>): boolean {
  if (item.score !== null || item.points_possible !== null || item.weight_override !== null) return true;
  if (item.component_id !== null && componentIds.has(item.component_id)) return true;
  return item.kind !== 'reading';
}

function byDueThenTitle(a: EngineItem, b: EngineItem): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface GradeGroup<T extends EngineItem = EngineItem> {
  key: string;
  /** component = a grading category; standalone = an item with its own weight; uncounted = no weight. */
  kind: 'component' | 'standalone' | 'uncounted';
  title: string;
  weight: number | null;
  componentId: string | null;
  percent: number | null;
  gradedCount: number;
  dropLowest: number;
  droppedIds: ReadonlySet<string>;
  items: T[];
  /** Items the syllabus expects in this category that are not listed yet. */
  missing: number;
}

/** Categories in display order, then standalone weighted items, then anything not counted. */
export function buildGradeGroups<T extends EngineItem>(
  courseId: string,
  components: readonly EngineComponent[],
  items: readonly T[],
  grade: CourseGrade,
): GradeGroup<T>[] {
  const own = components.filter((component) => component.course_id === courseId);
  const known = new Set(own.map((component) => component.id));
  const courseItems = items.filter((item) => item.course_id === courseId && isGradeable(item, known)).sort(byDueThenTitle);
  const gradeById = new Map(grade.components.map((entry) => [entry.component_id, entry]));

  const groups: GradeGroup<T>[] = own.map((component) => {
    const entry = gradeById.get(component.id);
    const linked = courseItems.filter((item) => item.component_id === component.id);
    const expected = component.expected_count ?? 0;
    return {
      key: component.id,
      kind: 'component',
      title: component.name,
      weight: Math.max(0, component.weight),
      componentId: component.id,
      percent: entry?.percent ?? null,
      gradedCount: entry?.gradedCount ?? 0,
      dropLowest: Math.max(0, Math.floor(component.drop_lowest)),
      droppedIds: new Set(entry?.droppedItemIds ?? []),
      items: linked,
      missing: Math.max(0, expected - linked.length),
    };
  });

  const unlinked = courseItems.filter((item) => item.component_id === null || !known.has(item.component_id));
  for (const item of unlinked) {
    if (item.weight_override === null) continue;
    const entry = gradeById.get(item.id);
    groups.push({
      key: `item:${item.id}`,
      kind: 'standalone',
      title: item.title,
      weight: Math.max(0, item.weight_override),
      componentId: null,
      percent: entry?.percent ?? null,
      gradedCount: entry?.gradedCount ?? 0,
      dropLowest: 0,
      droppedIds: new Set(),
      items: [item],
      missing: 0,
    });
  }

  const uncounted = unlinked.filter((item) => item.weight_override === null);
  if (uncounted.length > 0) {
    groups.push({
      key: 'uncounted',
      kind: 'uncounted',
      title: 'Not in a weighted category',
      weight: null,
      componentId: null,
      percent: null,
      gradedCount: uncounted.filter((item) => item.score !== null).length,
      dropLowest: 0,
      droppedIds: new Set(),
      items: uncounted,
      missing: 0,
    });
  }
  return groups;
}

/** Percent of the course grade one item is worth, when known. */
export function itemWeight(item: EngineItem, components: EngineComponent[], items: EngineItem[]): number | null {
  return effectiveWeight(item, components, items);
}

// ---- what do I need? ----------------------------------------------------------------------

/** Ungraded items that can still move the grade (linked to a weighted category or self-weighted), soonest first. */
export function openWeightedItems<T extends EngineItem>(
  courseId: string,
  components: readonly EngineComponent[],
  items: readonly T[],
): T[] {
  const weighted = new Map(
    components.filter((component) => component.course_id === courseId).map((component) => [component.id, component.weight]),
  );
  return items
    .filter((item) => {
      if (item.course_id !== courseId || item.score !== null) return false;
      if (item.component_id !== null && weighted.has(item.component_id)) return (weighted.get(item.component_id) ?? 0) > 0;
      return item.weight_override !== null && item.weight_override > 0;
    })
    .sort(byDueThenTitle);
}

const FINAL = /\bfinals?\b/i;

function isMajor(item: EngineItem): boolean {
  return isMajorKind(item.kind) || item.is_major;
}

function latest<T extends EngineItem>(items: readonly T[]): T | null {
  return items.length > 0 ? items[items.length - 1] : null;
}

/** The final exam, else the last major ungraded item, else the last ungraded item. */
export function defaultTargetItem<T extends EngineItem>(candidates: readonly T[]): T | null {
  const sorted = [...candidates].sort(byDueThenTitle);
  return (
    latest(sorted.filter((item) => item.kind === 'exam' && FINAL.test(item.title))) ??
    latest(sorted.filter((item) => isMajor(item) && FINAL.test(item.title))) ??
    latest(sorted.filter(isMajor)) ??
    latest(sorted)
  );
}

/** The course target, else "keep the letter you have", else a B-ish 80. */
export function defaultTargetPercent(course: EngineCourse, grade: Pick<CourseGrade, 'percent'>): number {
  if (course.target_percent !== null && Number.isFinite(Number(course.target_percent))) {
    return clampPercent(Number(course.target_percent));
  }
  const letter = letterForCourse(grade.percent, course);
  const cutoff = sortedScale(course).find((entry) => entry.letter === letter);
  if (cutoff && cutoff.min > 0) return clampPercent(cutoff.min);
  return 80;
}

export function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

export type Feasibility = 'secured' | 'within_reach' | 'stretch' | 'out_of_reach' | 'unknown';

export function feasibilityOf(result: Pick<RequiredScore, 'alreadySecured' | 'achievable' | 'neededPercent'>): Feasibility {
  if (result.alreadySecured) return 'secured';
  if (result.neededPercent === null) return 'unknown';
  if (!result.achievable || result.neededPercent > 100) return 'out_of_reach';
  return result.neededPercent <= WITHIN_REACH_MAX ? 'within_reach' : 'stretch';
}

export const FEASIBILITY_COPY: Record<Feasibility, { label: string; tone: 'green' | 'yellow' | 'red' | null }> = {
  secured: { label: 'Already secured', tone: 'green' },
  within_reach: { label: 'Within reach', tone: 'green' },
  stretch: { label: 'A stretch', tone: 'yellow' },
  out_of_reach: { label: 'Out of reach', tone: 'red' },
  unknown: { label: 'Not enough info', tone: null },
};

// ---- projected range ------------------------------------------------------------------------

export type RangeOutlook = 'secured' | 'possible' | 'out_of_reach';

/** Where the target sits against the worst-case / best-case final. */
export function rangeOutlook(min: number | null, max: number | null, target: number | null): RangeOutlook | null {
  if (min === null || max === null || target === null) return null;
  if (min + 1e-9 >= target) return 'secured';
  if (max + 1e-9 < target) return 'out_of_reach';
  return 'possible';
}

// ---- scenario simulator -------------------------------------------------------------------------

/** Starting point for each slider: the category's current average, else the course's, else the target. */
export function defaultHypotheticals(
  candidates: readonly EngineItem[],
  grade: Pick<CourseGrade, 'percent' | 'components'>,
  course: Pick<EngineCourse, 'target_percent'>,
): Record<string, number> {
  const averages = new Map(grade.components.map((entry) => [entry.component_id, entry.percent]));
  const fallback = grade.percent ?? (course.target_percent !== null ? Number(course.target_percent) : null) ?? 80;
  const values: Record<string, number> = {};
  for (const item of candidates) {
    const own = item.component_id !== null ? averages.get(item.component_id) : undefined;
    values[item.id] = Math.round(clampPercent(own ?? fallback));
  }
  return values;
}

// ---- score entry --------------------------------------------------------------------------------

/** "18.5", "18,5", " 90 % " -> number; "" -> null; anything else -> NaN. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(',', '.').replace(/%$/, '');
  if (cleaned === '') return null;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export type ScoreEntryMode = 'points' | 'percent';

export interface ScoreDraft {
  mode: ScoreEntryMode;
  /** Points earned; "18/20" is understood as score and points together. */
  score: string;
  /** Points possible. */
  points: string;
  percent: string;
}

export type ScoreParseResult =
  | { ok: true; score: number; pointsPossible: number | null }
  | { ok: false; field: 'score' | 'points' | 'percent'; message: string };

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function draftFor(item: Pick<EngineItem, 'score' | 'points_possible'>): ScoreDraft {
  const hasPoints = item.points_possible !== null && item.points_possible > 0;
  const percent = itemPercent(item);
  return {
    mode: hasPoints ? 'points' : 'percent',
    score: item.score !== null && hasPoints ? formatScoreNumber(item.score) : '',
    points: hasPoints && item.points_possible !== null ? formatScoreNumber(item.points_possible) : '',
    percent: percent !== null ? formatScoreNumber(percent) : '',
  };
}

/**
 * Turns the inline editor's text into what gets saved. Percent entries keep an item's points
 * (Canvas assignments stay "18 / 20"); items without points store the percent as the score.
 */
export function parseScoreDraft(draft: ScoreDraft, item: Pick<EngineItem, 'points_possible'>): ScoreParseResult {
  if (draft.mode === 'percent') {
    const percent = parseDecimal(draft.percent);
    if (percent === null) return { ok: false, field: 'percent', message: 'Enter a percent.' };
    if (Number.isNaN(percent)) return { ok: false, field: 'percent', message: 'Use a number like 87.5.' };
    if (percent > MAX_ENTRY_PERCENT) {
      return { ok: false, field: 'percent', message: `That's over ${MAX_ENTRY_PERCENT}%. Check the number.` };
    }
    const points = item.points_possible;
    if (points !== null && points > 0) return { ok: true, score: roundScore((percent / 100) * points), pointsPossible: points };
    return { ok: true, score: roundScore(percent), pointsPossible: null };
  }

  let scoreText = draft.score;
  let pointsText = draft.points;
  const slash = scoreText.indexOf('/');
  if (slash >= 0) {
    pointsText = scoreText.slice(slash + 1);
    scoreText = scoreText.slice(0, slash);
  }
  const score = parseDecimal(scoreText);
  if (score === null) return { ok: false, field: 'score', message: 'Enter your score.' };
  if (Number.isNaN(score)) return { ok: false, field: 'score', message: 'Use a number like 18.5.' };
  const points = parseDecimal(pointsText);
  if (points === null) return { ok: false, field: 'points', message: "Enter what it's out of." };
  if (Number.isNaN(points)) return { ok: false, field: 'points', message: 'Use a number like 20.' };
  if (points <= 0) return { ok: false, field: 'points', message: 'Points possible must be more than 0.' };
  if ((score / points) * 100 > MAX_ENTRY_PERCENT) {
    return { ok: false, field: 'score', message: `That's over ${MAX_ENTRY_PERCENT}% of ${formatScoreNumber(points)}. Check the numbers.` };
  }
  return { ok: true, score: roundScore(score), pointsPossible: roundScore(points) };
}
