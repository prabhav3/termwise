// buildPlan / rescheduleAfterMiss (docs/ENGINE.md "buildPlan" and "rescheduleAfterMiss").
//
// Pipeline: lock history → remaining work per item → per-kind windows → capacity-aware
// water-filling in (due, impact, id) order → pop-quiz reviews → deterministic keys → overflow
// warnings → day loads. Everything is a pure function of the input.
import { addDays, dayOfWeek, diffDays, eachDay, maxDate, minDate } from './dates';
import { annotateItems, pagesPerHour, readingMinutes } from './effort';
import { clamp, courseLabel, formatDayDate, formatDayRange, formatMinutes, roundTo5 } from './format';
import {
  examReviewLabel,
  finalMilestoneLabel,
  MILESTONE_LABELS,
  POP_QUIZ_LABEL,
  readingLabel,
  studyLabel,
  timedReadingLabel,
  workLabel,
} from './labels';
import { blockPages, computeDayLoads, studyDayChecker } from './load';
import { overflowWarning } from './overflow';
import { contiguousRuns, resolveReading, segmentPages, subtractRange, takePages, type PageSegment, type ResolvedReading } from './pages';
import { fillPool, LoadBook, placeFixed, unitsToMinutes, type Allocation, type Pool } from './placement';
import type {
  AnnotatedItem,
  BlockKind,
  EngineBlock,
  EngineCourse,
  ISODate,
  OverflowWarning,
  PlanInput,
  PlanResult,
  RescheduleResult,
} from './types';
import { byString, isOpen } from './util';

const OVERFLOW_FACTOR = 1.25;
const MAX_PLAN_DAYS = 180;
/** A day's first piece of an item is at least this long (no 5-minute crumbs). */
const MIN_PIECE_MINUTES = 15;
/** After the first piece, days grow in small steps so loads level out evenly. */
const LEVEL_STEP_MINUTES = 5;
const MIN_READING_PAGES = 5;
const POP_QUIZ_MINUTES = 10;
const POP_QUIZ_HORIZON_DAYS = 14;

/** Order of blocks within a day: milestones first, then pop-quiz reviews, regular work, exam reviews. */
const GROUP_MILESTONE = 0;
const GROUP_POP_QUIZ = 1;
const GROUP_WORK = 2;
const GROUP_EXAM_REVIEW = 3;

/** Chronological order of the buffer generator's check-ins (also their order on a shared day). */
const MILESTONE_SEQ = { start: 0, outline: 1, draft: 2, final: 3 } as const;

const KEY_PATTERN = /^(.+):(reading|work|milestone|study|review):(\d+)$/;

interface ItemHistory {
  doneMinutes: number;
  /** Manual planned blocks dated today or later: the student already scheduled this work. */
  manualPlannedMinutes: number;
  /** Page ranges already read or scheduled by hand. */
  coveredRanges: { start: number; end: number }[];
  /** Done / manual reading time with no page numbers (converted to pages at reading speed). */
  pagelessMinutes: number;
  /** Dates ≥ today with a missed/skipped block: the student couldn't do this item's work then. */
  blockedDates: Set<ISODate>;
  completedMilestones: Set<string>;
  reviewDates: ISODate[];
  hasDoneWork: boolean;
  maxKeyNumber: number;
}

interface Draft {
  item: AnnotatedItem;
  date: ISODate;
  kind: BlockKind;
  minutes: number;
  label: string;
  page_start: number | null;
  page_end: number | null;
  group: number;
  /** Tie-break within an item's group on one day (milestone sequence). */
  order: number;
}

interface ItemOutcome {
  item: AnnotatedItem;
  unplaced: number;
  windowDays: ISODate[];
  blocked: Set<ISODate>;
}

interface PlanContext {
  input: PlanInput;
  today: ISODate;
  cap: number;
  overCap: number;
  isStudyDay: (date: ISODate) => boolean;
  book: LoadBook;
  drafts: Draft[];
}

interface InternalPlan extends PlanResult {
  newKeys: Set<string>;
}

// ---- helpers -------------------------------------------------------------------------------

function emptyHistory(): ItemHistory {
  return {
    doneMinutes: 0,
    manualPlannedMinutes: 0,
    coveredRanges: [],
    pagelessMinutes: 0,
    blockedDates: new Set(),
    completedMilestones: new Set(),
    reviewDates: [],
    hasDoneWork: false,
    maxKeyNumber: 0,
  };
}

function collectHistory(kept: EngineBlock[], today: ISODate): Map<string, ItemHistory> {
  const histories = new Map<string, ItemHistory>();
  for (const block of kept) {
    let history = histories.get(block.item_id);
    if (!history) {
      history = emptyHistory();
      histories.set(block.item_id, history);
    }
    const match = KEY_PATTERN.exec(block.key);
    if (match && match[1] === block.item_id) history.maxKeyNumber = Math.max(history.maxKeyNumber, Number(match[3]));

    const countsAsWork = block.status === 'done' || (block.status === 'planned' && block.date >= today);
    if (countsAsWork) {
      if (block.status === 'done') {
        history.doneMinutes += block.minutes;
        history.hasDoneWork = true;
      } else {
        history.manualPlannedMinutes += block.minutes;
      }
      const { page_start: start, page_end: end } = block;
      if (start != null && end != null && end >= start) history.coveredRanges.push({ start, end });
      else history.pagelessMinutes += block.minutes;
    }
    if ((block.status === 'missed' || block.status === 'skipped') && block.date >= today) history.blockedDates.add(block.date);
    if (block.status === 'done' || block.status === 'skipped') {
      if (block.kind === 'milestone') history.completedMilestones.add(block.label);
      if (block.kind === 'review') history.reviewDates.push(block.date);
    }
  }
  return histories;
}

function remainingMinutes(item: AnnotatedItem, history: ItemHistory): number {
  return Math.max(0, Math.ceil(item.effortMinutes - history.doneMinutes - history.manualPlannedMinutes));
}

/** Study days in [max(start, today), end] that this item may use. */
function studyDays(ctx: PlanContext, start: ISODate, end: ISODate, blocked: Set<ISODate>): ISODate[] {
  const from = maxDate(start, ctx.today) ?? ctx.today;
  if (end < from) return [];
  return eachDay(from, end).filter((date) => ctx.isStudyDay(date) && !blocked.has(date));
}

/** A window with no study day collapses to the latest study day ≤ due − 1, or today. */
function collapse(ctx: PlanContext, due: ISODate, blocked: Set<ISODate>): ISODate[] {
  const last = addDays(due, -1);
  if (last < ctx.today) return [];
  for (let date = last; date >= ctx.today; date = addDays(date, -1)) {
    if (ctx.isStudyDay(date) && !blocked.has(date)) return [date];
  }
  return blocked.has(ctx.today) ? [] : [ctx.today];
}

function windowDays(ctx: PlanContext, start: ISODate, due: ISODate, blocked: Set<ISODate>): ISODate[] {
  const days = studyDays(ctx, start, addDays(due, -1), blocked);
  return days.length > 0 ? days : collapse(ctx, due, blocked);
}

/**
 * Days outside the window used only when nothing else fits: the due date (never for papers and
 * projects), and for presentations the day before it first.
 */
function lastResort(ctx: PlanContext, item: AnnotatedItem, due: ISODate, window: ISODate[], blocked: Set<ISODate>): ISODate[] {
  if (item.kind === 'paper' || item.kind === 'project') return [];
  const days = item.kind === 'presentation' ? [addDays(due, -1), due] : [due];
  return days.filter((date) => date >= ctx.today && !blocked.has(date) && !window.includes(date));
}

/** Minute work: a day's first piece ≥ 15 min, then 5-minute leveling steps. */
function minutePool(days: ISODate[], weights?: number[]): Pool {
  return { unitMinutes: 1, chunkUnits: LEVEL_STEP_MINUTES, minNewDayUnits: MIN_PIECE_MINUTES, days, weights };
}

/** Capacity pass, then the 125% overflow pass, then the last-resort days in order. */
function runPool(
  ctx: PlanContext,
  pool: Pool,
  units: number,
  resort: ISODate[],
  alloc: Allocation = new Map(),
): { alloc: Allocation; leftover: number } {
  let leftover = fillPool(pool, alloc, ctx.book, ctx.cap, units);
  if (leftover > 0) leftover = fillPool(pool, alloc, ctx.book, ctx.overCap, leftover);
  for (const day of resort) {
    if (leftover <= 0) break;
    leftover = fillPool({ ...pool, days: [day], weights: undefined }, alloc, ctx.book, ctx.overCap, leftover);
  }
  return { alloc, leftover };
}

/** Ramp weights 1, 1.5, 2, … so sessions grow toward the test (4 days ≈ 14/21/29/36%). */
function rampWeights(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 1 + 0.5 * i);
}

/** How many trailing window days the ramp uses: as many as keep the first session ≥ 15 min. */
function rampLength(minutes: number, available: number): number {
  for (let count = available; count > 1; count--) {
    const weights = rampWeights(count);
    const total = weights.reduce((a, b) => a + b, 0);
    if ((minutes * weights[0]) / total >= MIN_PIECE_MINUTES) return count;
  }
  return Math.min(1, available);
}

/** Growing per-day session lengths (5-minute steps) that sum to `minutes`. */
function rampTargets(minutes: number, count: number): number[] {
  const weights = rampWeights(count);
  const total = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  let previous = 0;
  return weights.map((weight, i) => {
    cumulative += weight;
    const boundary = i === count - 1 ? minutes : Math.min(minutes, roundTo5((minutes * cumulative) / total));
    const part = boundary - previous;
    previous = boundary;
    return part;
  });
}

/**
 * Test prep: the item's own sessions grow toward the test on the last study days. Whatever a
 * full day can't take is water-filled over the whole window (later days still favoured), then
 * the usual overflow and last-resort passes.
 */
function runRamp(ctx: PlanContext, days: ISODate[], minutes: number, resort: ISODate[]): { alloc: Allocation; leftover: number } {
  const alloc: Allocation = new Map();
  const count = rampLength(minutes, days.length);
  const rampDays = days.slice(days.length - count);
  const targets = rampTargets(minutes, count);
  let leftover = minutes;
  rampDays.forEach((day, i) => {
    const piece = Math.min(targets[i], ctx.cap - ctx.book.get(day));
    if (piece <= 0 || piece < Math.min(MIN_PIECE_MINUTES, targets[i])) return;
    ctx.book.add(day, piece);
    alloc.set(day, piece);
    leftover -= piece;
  });
  if (leftover <= 0) return { alloc, leftover: 0 };
  return runPool(ctx, minutePool(days, rampWeights(days.length)), leftover, resort, alloc);
}

function sortedEntries(alloc: Allocation): [ISODate, number][] {
  return [...alloc.entries()].filter(([, units]) => units > 0).sort(([a], [b]) => byString(a, b));
}

function pushMinuteDrafts(
  ctx: PlanContext,
  item: AnnotatedItem,
  alloc: Allocation,
  kind: BlockKind,
  label: (minutes: number) => string,
): void {
  for (const [date, minutes] of sortedEntries(alloc)) {
    ctx.drafts.push({ item, date, kind, minutes, label: label(minutes), page_start: null, page_end: null, group: GROUP_WORK, order: 0 });
  }
}

/** Nearest days first (ties: earlier). */
function byDistance(days: ISODate[], target: ISODate): ISODate[] {
  return [...days].sort((a, b) => Math.abs(diffDays(target, a)) - Math.abs(diffDays(target, b)) || byString(a, b));
}

/** Splits `total` minutes across parts proportionally to `weights`, each part ≥ 1 when possible. */
function splitMinutes(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  let previous = 0;
  const parts = weights.map((w) => {
    cumulative += w;
    const upTo = Math.ceil((cumulative / sum) * total - 1e-9);
    const part = upTo - previous;
    previous = upTo;
    return part;
  });
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] > 0) continue;
    const donor = parts.indexOf(Math.max(...parts));
    if (parts[donor] <= 1) break;
    parts[donor] -= 1;
    parts[i] = 1;
  }
  return parts;
}

// ---- per-kind strategies -------------------------------------------------------------------

function planTask(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  const blocked = history.blockedDates;
  const start = maxDate(addDays(due, -3), item.assigned_date) ?? addDays(due, -3);
  const days = windowDays(ctx, start, due, blocked);
  const minutes = remainingMinutes(item, history);
  if (minutes <= 0) return { item, unplaced: 0, windowDays: days, blocked };
  const { alloc, leftover } = runPool(ctx, minutePool(days), minutes, lastResort(ctx, item, due, days, blocked));
  pushMinuteDrafts(ctx, item, alloc, 'work', (m) => workLabel(item.title, m));
  return { item, unplaced: leftover, windowDays: days, blocked };
}

function unreadSegments(reading: ResolvedReading, history: ItemHistory, ctx: PlanContext): PageSegment[] {
  let unread = reading.segments;
  for (const range of history.coveredRanges) unread = subtractRange(unread, range.start, range.end);
  const pagelessPages = Math.floor((history.pagelessMinutes * pagesPerHour(ctx.input.settings)) / 60 + 1e-9);
  return pagelessPages > 0 ? takePages(unread, pagelessPages).rest : unread;
}

function pushReadingDrafts(
  ctx: PlanContext,
  item: AnnotatedItem,
  alloc: Allocation,
  unread: PageSegment[],
  unitMinutes: number,
  reading: ResolvedReading,
): void {
  let rest = unread;
  for (const [date, pages] of sortedEntries(alloc)) {
    const minutes = unitsToMinutes(pages, unitMinutes);
    const taken = takePages(rest, pages);
    rest = taken.rest;
    // One block per run of consecutive pages, so page_start/page_end stay truthful.
    let runs = contiguousRuns(taken.taken);
    while (runs.length > 1 && runs.length > minutes) {
      let closest = 0;
      for (let i = 1; i < runs.length - 1; i++) {
        const gap = runs[i + 1][0].start - runs[i][runs[i].length - 1].end;
        const best = runs[closest + 1][0].start - runs[closest][runs[closest].length - 1].end;
        if (gap < best) closest = i;
      }
      runs = [...runs.slice(0, closest), [...runs[closest], ...runs[closest + 1]], ...runs.slice(closest + 2)];
    }
    const split = splitMinutes(minutes, runs.map((run) => segmentPages(run)));
    runs.forEach((run, i) => {
      ctx.drafts.push({
        item,
        date,
        kind: 'reading',
        minutes: split[i],
        label: readingLabel(run, reading, item.title),
        page_start: run[0].start,
        page_end: run[run.length - 1].end,
        group: GROUP_WORK,
        order: 0,
      });
    });
  }
}

function planReading(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  const blocked = history.blockedDates;
  const days = windowDays(ctx, item.assigned_date ?? addDays(due, -7), due, blocked);
  const resort = lastResort(ctx, item, due, days, blocked);
  const reading = resolveReading(item, ctx.input.textbooks, ctx.input.settings);

  if (reading === null) {
    const minutes = remainingMinutes(item, history);
    if (minutes <= 0) return { item, unplaced: 0, windowDays: days, blocked };
    const { alloc, leftover } = runPool(ctx, minutePool(days), minutes, resort);
    pushMinuteDrafts(ctx, item, alloc, 'reading', (m) => timedReadingLabel(item.title, m));
    return { item, unplaced: leftover, windowDays: days, blocked };
  }

  const unread = unreadSegments(reading, history, ctx);
  const pages = segmentPages(unread);
  if (pages === 0) return { item, unplaced: 0, windowDays: days, blocked };
  // Pages are the unit of truth; minutes never drop below reading speed for the pages left.
  const minutes = Math.max(remainingMinutes(item, history), readingMinutes(pages, ctx.input.settings));
  const unitMinutes = minutes / pages;
  // Whole pages: a day's first piece is ≥ 5 pages and ≥ 15 minutes, then one page at a time.
  const pool: Pool = {
    unitMinutes,
    chunkUnits: 1,
    minNewDayUnits: Math.max(MIN_READING_PAGES, Math.ceil(MIN_PIECE_MINUTES / unitMinutes - 1e-9)),
    days,
  };
  const { alloc, leftover } = runPool(ctx, pool, pages, resort);
  pushReadingDrafts(ctx, item, alloc, unread, unitMinutes, reading);
  return { item, unplaced: unitsToMinutes(leftover, unitMinutes), windowDays: days, blocked };
}

function planQuiz(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  const blocked = history.blockedDates;
  const candidates = studyDays(ctx, item.assigned_date ?? ctx.today, addDays(due, -1), blocked).slice(-2);
  const days = candidates.length > 0 ? candidates : collapse(ctx, due, blocked);
  const minutes = remainingMinutes(item, history);
  if (minutes <= 0) return { item, unplaced: 0, windowDays: days, blocked };
  const { alloc, leftover } = runRamp(ctx, days, minutes, lastResort(ctx, item, due, days, blocked));
  pushMinuteDrafts(ctx, item, alloc, 'study', (m) => studyLabel(item.title, m));
  return { item, unplaced: leftover, windowDays: days, blocked };
}

function planExam(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  const blocked = history.blockedDates;
  const rampStart = addDays(due, item.impact.isHighImpact ? -7 : -4);
  const days = windowDays(ctx, maxDate(rampStart, item.assigned_date) ?? rampStart, due, blocked);
  const resort = lastResort(ctx, item, due, days, blocked);
  const minutes = remainingMinutes(item, history);
  if (minutes <= 0) return { item, unplaced: 0, windowDays: days, blocked };

  let reviewMinutes = 0;
  const reviewDone = history.reviewDates.some((date) => date >= addDays(due, -1));
  if (!reviewDone) {
    const wanted = Math.min(minutes, clamp(roundTo5(minutes * 0.15), MIN_PIECE_MINUTES, 45));
    // Keep it on due − 1 even if that day runs into the overflow allowance.
    const date = placeFixed(wanted, [...days].reverse().concat(resort), ctx.book, [ctx.cap, ctx.overCap], true);
    if (date !== null) {
      reviewMinutes = wanted;
      ctx.drafts.push({
        item,
        date,
        kind: 'review',
        minutes: wanted,
        label: examReviewLabel(item.title, wanted),
        page_start: null,
        page_end: null,
        group: GROUP_EXAM_REVIEW,
        order: 0,
      });
    }
  }

  const studyMinutes = minutes - reviewMinutes;
  if (studyMinutes <= 0) return { item, unplaced: 0, windowDays: days, blocked };
  const { alloc, leftover } = runRamp(ctx, days, studyMinutes, resort);
  pushMinuteDrafts(ctx, item, alloc, 'study', (m) => studyLabel(item.title, m));
  return { item, unplaced: leftover, windowDays: days, blocked };
}

interface MilestoneSpec {
  label: string;
  date: ISODate;
  seq: number;
}

/**
 * Which check-ins to schedule and on which window day, in chronological order. When the window
 * is too short for all four on separate days, they are kept in priority order: final review,
 * start, full draft, outline.
 */
function milestonePlan(item: AnnotatedItem, days: ISODate[], due: ISODate, history: ItemHistory): MilestoneSpec[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days[days.length - 1];
  const at = (from: ISODate, to: ISODate, fraction: number) => addDays(from, Math.round(fraction * diffDays(from, to)));
  // High-impact work gets the full-draft check-in two weeks out; the outline then sits ~40% of
  // the way to that draft so the check-ins stay in order.
  const twoWeeks = addDays(due, -14);
  const pinnedDraft = item.impact.isHighImpact && twoWeeks > first && twoWeeks <= last;
  const draftDate = pinnedDraft ? twoWeeks : at(first, last, 0.7);
  const outlineDate = pinnedDraft ? at(first, twoWeeks, 0.4) : at(first, last, 0.4);

  const candidates = [
    { label: finalMilestoneLabel(item.kind), date: last, seq: MILESTONE_SEQ.final, skip: false },
    { label: MILESTONE_LABELS.start, date: first, seq: MILESTONE_SEQ.start, skip: history.hasDoneWork },
    { label: MILESTONE_LABELS.draft, date: draftDate, seq: MILESTONE_SEQ.draft, skip: false },
    { label: MILESTONE_LABELS.outline, date: outlineDate, seq: MILESTONE_SEQ.outline, skip: false },
  ];
  const taken = new Set<ISODate>();
  const plan: MilestoneSpec[] = [];
  for (const candidate of candidates) {
    if (candidate.skip || history.completedMilestones.has(candidate.label)) continue;
    const date = byDistance(days, candidate.date)[0];
    if (taken.has(date)) continue;
    taken.add(date);
    plan.push({ label: candidate.label, date, seq: candidate.seq });
  }
  return plan.sort((a, b) => a.seq - b.seq);
}

/** Papers, projects, presentations: early start, milestone check-ins, finish by due − 2. */
function planBuffered(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  const blocked = history.blockedDates;
  const weight = item.impact.weight;
  const lead = (weight !== null && weight >= 20) || item.impact.isHighImpact ? 21 : weight !== null && weight >= 10 ? 14 : 7;
  const start = maxDate(ctx.today, item.assigned_date, addDays(due, -lead)) ?? ctx.today;
  let days = studyDays(ctx, start, addDays(due, -2), blocked);
  if (days.length === 0) days = studyDays(ctx, start, addDays(due, -1), blocked);
  if (days.length === 0) days = collapse(ctx, due, blocked);
  const resort = lastResort(ctx, item, due, days, blocked);
  let budget = remainingMinutes(item, history);
  if (budget <= 0) return { item, unplaced: 0, windowDays: days, blocked };

  const milestoneDays = days.length > 0 ? days : resort;
  const reachable = [...milestoneDays, ...resort.filter((d) => !milestoneDays.includes(d))];
  const milestoneMinutes = clamp(roundTo5(item.effortMinutes * 0.04), MIN_PIECE_MINUTES, 30);
  const plan = milestonePlan(item, milestoneDays, due, history);
  // Placed in order; a check-in pushed off its day by a full schedule stays between its
  // neighbours (preferring a day of its own) so the sequence never runs backwards.
  let floor: ISODate | null = null;
  for (let i = 0; i < plan.length && budget > 0; i++) {
    const milestone = plan[i];
    const ceiling = plan[i + 1]?.date ?? null;
    const lower = floor;
    const candidates = byDistance(
      reachable.filter((d) => (lower === null || d >= lower) && (ceiling === null || d <= ceiling)),
      milestone.date,
    ).sort((a, b) => Number(a === lower || a === ceiling) - Number(b === lower || b === ceiling));
    const minutes = Math.min(milestoneMinutes, budget);
    const date = placeFixed(minutes, candidates, ctx.book, [ctx.cap, ctx.overCap], false);
    if (date === null) continue; // no room anywhere: its minutes stay in the pool below
    floor = date;
    budget -= minutes;
    ctx.drafts.push({
      item,
      date,
      kind: 'milestone',
      minutes,
      label: milestone.label,
      page_start: null,
      page_end: null,
      group: GROUP_MILESTONE,
      order: milestone.seq,
    });
  }
  if (budget <= 0) return { item, unplaced: 0, windowDays: days, blocked };

  const { alloc, leftover } = runPool(ctx, minutePool(days), budget, resort);
  pushMinuteDrafts(ctx, item, alloc, 'work', (m) => workLabel(item.title, m));
  return { item, unplaced: leftover, windowDays: days, blocked };
}

function planItem(ctx: PlanContext, item: AnnotatedItem, due: ISODate, history: ItemHistory): ItemOutcome {
  switch (item.kind) {
    case 'reading':
      return planReading(ctx, item, due, history);
    case 'quiz':
      return planQuiz(ctx, item, due, history);
    case 'exam':
      return planExam(ctx, item, due, history);
    case 'paper':
    case 'project':
    case 'presentation':
      return planBuffered(ctx, item, due, history);
    default:
      return planTask(ctx, item, due, history);
  }
}

/** Courses that warn about unannounced quizzes get a 10-minute review on class days with nothing else. */
function addPopQuizReviews(
  ctx: PlanContext,
  annotated: AnnotatedItem[],
  kept: EngineBlock[],
  histories: Map<string, ItemHistory>,
): void {
  const busy = new Set<string>();
  for (const block of kept) if (block.status === 'planned' || block.status === 'done') busy.add(`${block.date}|${block.course_id}`);
  for (const draft of ctx.drafts) busy.add(`${draft.date}|${draft.item.course_id}`);

  const courses = ctx.input.courses
    .filter((c) => c.policies?.unannounced_quizzes === true && !c.archived && c.meeting_days.length > 0)
    .sort((a, b) => byString(a.id, b.id));
  const horizon = eachDay(ctx.today, addDays(ctx.today, POP_QUIZ_HORIZON_DAYS - 1));
  for (const course of courses) {
    const carriers = annotated
      .filter((i) => i.course_id === course.id && isOpen(i) && i.due_date !== null && i.due_date >= ctx.today)
      .sort(
        (a, b) =>
          Number(b.kind === 'quiz') - Number(a.kind === 'quiz') ||
          byString(a.due_date ?? '', b.due_date ?? '') ||
          byString(a.id, b.id),
      );
    for (const date of horizon) {
      if (!course.meeting_days.includes(dayOfWeek(date)) || !ctx.isStudyDay(date)) continue;
      if ((course.start_date && date < course.start_date) || (course.end_date && date > course.end_date)) continue;
      if (busy.has(`${date}|${course.id}`)) continue;
      // The block hangs off an open item still due on/after that day (papers keep their due − 2 buffer).
      const carrier = carriers.find((i) => {
        const latest = i.kind === 'paper' || i.kind === 'project' ? addDays(date, 2) : date;
        return (i.due_date ?? '') >= latest && !histories.get(i.id)?.blockedDates.has(date);
      });
      if (!carrier || ctx.book.get(date) + POP_QUIZ_MINUTES > ctx.cap) continue;
      ctx.book.add(date, POP_QUIZ_MINUTES);
      busy.add(`${date}|${course.id}`);
      ctx.drafts.push({
        item: carrier,
        date,
        kind: 'review',
        minutes: POP_QUIZ_MINUTES,
        label: POP_QUIZ_LABEL,
        page_start: null,
        page_end: null,
        group: GROUP_POP_QUIZ,
        order: 0,
      });
    }
  }
}

/** Deterministic keys `${item_id}:${kind}:${n}` (n continues past history) and per-day sort order. */
function materialize(drafts: Draft[], kept: EngineBlock[], histories: Map<string, ItemHistory>, order: Map<string, number>): EngineBlock[] {
  const rank = (item: AnnotatedItem) => order.get(item.id) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...drafts].sort(
    (a, b) =>
      byString(a.date, b.date) ||
      a.group - b.group ||
      rank(a.item) - rank(b.item) ||
      byString(a.item.id, b.item.id) ||
      a.order - b.order ||
      (a.page_start ?? 0) - (b.page_start ?? 0) ||
      byString(a.label, b.label),
  );
  const used = new Set(kept.map((b) => b.key));
  const nextNumber = new Map<string, number>();
  const nextSortOrder = new Map<ISODate, number>();
  return sorted.map((draft) => {
    const itemId = draft.item.id;
    let n = nextNumber.get(itemId) ?? (histories.get(itemId)?.maxKeyNumber ?? 0) + 1;
    let key = `${itemId}:${draft.kind}:${n}`;
    while (used.has(key)) {
      n += 1;
      key = `${itemId}:${draft.kind}:${n}`;
    }
    used.add(key);
    nextNumber.set(itemId, n + 1);
    const sortOrder = nextSortOrder.get(draft.date) ?? 0;
    nextSortOrder.set(draft.date, sortOrder + 1);
    return {
      key,
      item_id: itemId,
      course_id: draft.item.course_id,
      date: draft.date,
      minutes: draft.minutes,
      kind: draft.kind,
      label: draft.label,
      page_start: draft.page_start,
      page_end: draft.page_end,
      status: 'planned',
      sort_order: sortOrder,
      generated_by: 'engine',
    };
  });
}

function compareBlocks(a: EngineBlock, b: EngineBlock): number {
  return byString(a.date, b.date) || a.sort_order - b.sort_order || byString(a.key, b.key);
}

// ---- buildPlan -----------------------------------------------------------------------------

function plan(input: PlanInput): InternalPlan {
  const settings = input.settings;
  const today = settings.today;
  const cap = Math.max(0, Math.floor(settings.daily_capacity_minutes));
  const annotated = annotateItems(input);
  const courses = new Map(input.courses.map((c) => [c.id, c]));

  // 1. Lock history; carry past engine-planned blocks over as missed; drop future ones.
  const kept: EngineBlock[] = [];
  const seenKeys = new Set<string>();
  for (const block of [...input.existingBlocks].sort((a, b) => byString(a.key, b.key))) {
    if (seenKeys.has(block.key)) continue;
    const engineMade = block.generated_by !== 'manual';
    if (engineMade && block.status === 'planned') {
      if (block.date < today) {
        kept.push({ ...block, status: 'missed' });
        seenKeys.add(block.key);
      }
      continue;
    }
    kept.push(block);
    seenKeys.add(block.key);
  }

  const book = new LoadBook();
  for (const block of kept) {
    if (block.date >= today && (block.status === 'planned' || block.status === 'done')) book.add(block.date, block.minutes);
  }
  const ctx: PlanContext = {
    input,
    today,
    cap,
    overCap: Math.floor(cap * OVERFLOW_FACTOR),
    isStudyDay: studyDayChecker(settings),
    book,
    drafts: [],
  };
  const histories = collectHistory(kept, today);

  // 2–5. Remaining work per item, placed in (due asc, impact desc, id) order.
  const plannable = annotated
    .filter((item) => {
      if (!isOpen(item) || item.due_date === null || item.due_date < today) return false;
      return courses.get(item.course_id)?.archived !== true;
    })
    .sort(
      (a, b) =>
        byString(a.due_date ?? '', b.due_date ?? '') || b.impact.score - a.impact.score || byString(a.id, b.id),
    );
  const order = new Map(plannable.map((item, index) => [item.id, index]));
  const outcomes = plannable.map((item) => planItem(ctx, item, item.due_date ?? today, histories.get(item.id) ?? emptyHistory()));
  addPopQuizReviews(ctx, annotated, kept, histories);

  // 6. Keys & labels.
  const fresh = materialize(ctx.drafts, kept, histories, order);
  const blocks = [...kept, ...fresh].sort(compareBlocks);

  const overflow: OverflowWarning[] = outcomes
    .filter((o) => o.unplaced > 0)
    .map((o) =>
      overflowWarning({
        item: o.item,
        course: courses.get(o.item.course_id),
        unplacedMinutes: o.unplaced,
        windowDays: o.windowDays,
        blocked: o.blocked,
        today,
        capacity: cap,
        isStudyDay: ctx.isStudyDay,
        book,
        scheduled: ctx.drafts,
      }),
    );

  // 7. Day loads from today to the latest due date (at most 180 days).
  const latestDue = maxDate(today, ...plannable.map((item) => item.due_date)) ?? today;
  const end = minDate(latestDue, addDays(today, MAX_PLAN_DAYS - 1)) ?? today;
  const days = computeDayLoads(blocks, settings, today, end);

  return { blocks, days, overflow, annotated, newKeys: new Set(fresh.map((b) => b.key)) };
}

export function buildPlan(input: PlanInput): PlanResult {
  const { blocks, days, overflow, annotated } = plan(input);
  return { blocks, days, overflow, annotated };
}

// ---- rescheduleAfterMiss -------------------------------------------------------------------

function rescheduleSummary(
  missed: EngineBlock,
  item: AnnotatedItem | undefined,
  course: EngineCourse | undefined,
  moved: EngineBlock[],
  warning: OverflowWarning | undefined,
  today: ISODate,
): string {
  if (!item) return 'Marked as missed.';
  const ref = `${courseLabel(course)} ${item.title}`;
  if (warning) return warning.suggestion;
  if (moved.length === 0) {
    if (item.status === 'done') return `Marked as missed — ${ref} is already done, so nothing needed to move.`;
    if (item.status === 'missed') return `Marked as missed — ${ref} is already marked missed.`;
    if (item.due_date === null) return `Marked as missed — ${ref} has no due date, so there's nothing to reschedule yet.`;
    if (item.due_date < today) return `Marked as missed — ${ref} was due ${formatDayDate(item.due_date)}.`;
    return `Marked as missed — you've already planned enough time for ${ref}.`;
  }
  const pages = blockPages(missed);
  const amount = pages > 0 ? `${pages} ${pages === 1 ? 'page' : 'pages'} of ${courseLabel(course)} reading` : `${formatMinutes(missed.minutes)} of ${ref}`;
  const first = moved[0].date;
  const last = moved[moved.length - 1].date;
  return first === last ? `Moved ${amount} to ${formatDayRange(first, last)}` : `Moved ${amount} across ${formatDayRange(first, last)}`;
}

export function rescheduleAfterMiss(input: PlanInput, missedBlockKey: string): RescheduleResult {
  const missed = input.existingBlocks.find((b) => b.key === missedBlockKey);
  if (!missed) {
    return { ...buildPlan(input), summary: 'That block is no longer in your plan — everything else is up to date.', moved: [] };
  }
  const marked: EngineBlock = { ...missed, status: 'missed' };
  const result = plan({ ...input, existingBlocks: input.existingBlocks.map((b) => (b.key === missedBlockKey ? marked : b)) });
  const moved = result.blocks.filter((b) => b.item_id === missed.item_id && result.newKeys.has(b.key));
  const item = result.annotated.find((i) => i.id === missed.item_id);
  const course = input.courses.find((c) => c.id === missed.course_id);
  const warning = result.overflow.find((w) => w.item_id === missed.item_id);
  return {
    blocks: result.blocks,
    days: result.days,
    overflow: result.overflow,
    annotated: result.annotated,
    summary: rescheduleSummary(marked, item, course, moved, warning, input.settings.today),
    moved: moved.map((b) => ({ key: b.key, date: b.date, minutes: b.minutes })),
  };
}
