// Public surface of the scheduling & grading engine. Pure TS — runs on device and in vitest.
//
// CONTRACT STUB: every export below has its final signature. The engine implementation replaces
// these bodies with real modules (dates.ts, impact.ts, effort.ts, planner.ts, load.ts,
// redzone.ts, triage.ts, pomodoro.ts, grades.ts, synthesis.ts) and turns this file into
// re-exports. Signatures are binding; behaviour rules live in docs/ENGINE.md.
import type {
  AnnotatedItem,
  CourseGrade,
  DayLoad,
  EngineBlock,
  EngineComponent,
  EngineCourse,
  EngineItem,
  EngineTermEvent,
  EngineTextbook,
  FocusTask,
  GradeCutoff,
  ImpactInfo,
  ISODate,
  ItemKind,
  MasterCalendar,
  OtherWorkAssumption,
  PlanInput,
  PlannerSettings,
  PlanResult,
  PomodoroSegment,
  RedZone,
  RequiredScore,
  RescheduleResult,
  StressLevel,
  TriageAction,
  WeekStress,
} from './types';

export * from './types';

const todo = (name: string): never => {
  throw new Error(`engine.${name} is not implemented yet`);
};

// ---- dates ------------------------------------------------------------------
export function addDays(date: ISODate, days: number): ISODate {
  return todo('addDays');
}
/** Whole days from `from` to `to` (to - from). */
export function diffDays(from: ISODate, to: ISODate): number {
  return todo('diffDays');
}
/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(date: ISODate): number {
  return todo('dayOfWeek');
}
/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return todo('startOfWeek');
}
/** Inclusive; [] when end < start. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  return todo('eachDay');
}
export function compareDates(a: ISODate, b: ISODate): number {
  return todo('compareDates');
}
export function minDate(...dates: Array<ISODate | null | undefined>): ISODate | null {
  return todo('minDate');
}
export function maxDate(...dates: Array<ISODate | null | undefined>): ISODate | null {
  return todo('maxDate');
}
export function isISODate(value: unknown): value is ISODate {
  return todo('isISODate');
}

// ---- impact -----------------------------------------------------------------
/** exam, paper, project, presentation */
export function isMajorKind(kind: ItemKind): boolean {
  return todo('isMajorKind');
}
export function effectiveWeight(item: EngineItem, components: EngineComponent[], allItems: EngineItem[]): number | null {
  return todo('effectiveWeight');
}
export function computeImpact(
  item: EngineItem,
  ctx: { course: EngineCourse | undefined; components: EngineComponent[]; items: EngineItem[]; settings: PlannerSettings },
): ImpactInfo {
  return todo('computeImpact');
}

// ---- effort -----------------------------------------------------------------
export const DEFAULT_EFFORT_MINUTES: Record<ItemKind, number> = {
  exam: 360,
  quiz: 60,
  paper: 600,
  project: 720,
  homework: 90,
  reading: 60,
  presentation: 240,
  lab: 120,
  discussion: 30,
  other: 60,
};
export function resolveReadingPages(item: EngineItem, textbooks: EngineTextbook[], settings: PlannerSettings): number | null {
  return todo('resolveReadingPages');
}
export function estimateEffortMinutes(
  item: EngineItem,
  pages: number | null,
  weight: number | null,
  settings: PlannerSettings,
): number {
  return todo('estimateEffortMinutes');
}
export function annotateItems(input: PlanInput): AnnotatedItem[] {
  return todo('annotateItems');
}

// ---- planner ----------------------------------------------------------------
export function buildPlan(input: PlanInput): PlanResult {
  return todo('buildPlan');
}
export function rescheduleAfterMiss(input: PlanInput, missedBlockKey: string): RescheduleResult {
  return todo('rescheduleAfterMiss');
}

// ---- load -------------------------------------------------------------------
export function computeDayLoads(blocks: EngineBlock[], settings: PlannerSettings, from: ISODate, to: ISODate): DayLoad[] {
  return todo('computeDayLoads');
}

// ---- red zones & stress ------------------------------------------------------
export function detectRedZones(
  items: AnnotatedItem[],
  courses: EngineCourse[],
  opts?: { from?: ISODate; windowDays?: number; minMajor?: number },
): RedZone[] {
  return todo('detectRedZones');
}
export function stressLevel(score: number): StressLevel {
  return todo('stressLevel');
}
export function weeklyStress(
  plan: PlanResult,
  courses: EngineCourse[],
  settings: PlannerSettings,
  from: ISODate,
  weeks: number,
): WeekStress[] {
  return todo('weeklyStress');
}

// ---- triage -------------------------------------------------------------------
/** Top `limit` (default 3) actions for `date` (default settings.today), one per item. */
export function triageForDate(
  plan: PlanResult,
  courses: EngineCourse[],
  settings: PlannerSettings,
  date?: ISODate,
  limit?: number,
): TriageAction[] {
  return todo('triageForDate');
}

// ---- pomodoro -------------------------------------------------------------------
/** "Study 25 mins for PSY 101 Quiz 1" */
export function focusLabel(
  item: Pick<EngineItem, 'title'>,
  course: Pick<EngineCourse, 'code' | 'title'> | undefined,
  minutes: number,
): string {
  return todo('focusLabel');
}
export function focusQueue(plan: PlanResult, courses: EngineCourse[], date: ISODate, focusMinutes: number): FocusTask[] {
  return todo('focusQueue');
}
export function pomodoroCycles(
  totalMinutes: number,
  focusMinutes?: number,
  shortBreakMinutes?: number,
  longBreakMinutes?: number,
  longEvery?: number,
): PomodoroSegment[] {
  return todo('pomodoroCycles');
}

// ---- grades -------------------------------------------------------------------
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
export function letterFor(percent: number | null, scale: GradeCutoff[]): string | null {
  return todo('letterFor');
}
export function itemPercent(item: Pick<EngineItem, 'score' | 'points_possible'>): number | null {
  return todo('itemPercent');
}
export function courseGrade(course: EngineCourse, components: EngineComponent[], items: EngineItem[]): CourseGrade {
  return todo('courseGrade');
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
  return todo('requiredScore');
}
export function simulateGrade(
  course: EngineCourse,
  components: EngineComponent[],
  items: EngineItem[],
  hypothetical: Record<string, number>,
): CourseGrade {
  return todo('simulateGrade');
}

// ---- synthesis -------------------------------------------------------------------
export function mergeTermEvents(events: EngineTermEvent[]): EngineTermEvent[] {
  return todo('mergeTermEvents');
}
export function synthesizeMasterCalendar(
  courses: EngineCourse[],
  items: AnnotatedItem[],
  termEvents: EngineTermEvent[],
): MasterCalendar {
  return todo('synthesizeMasterCalendar');
}
