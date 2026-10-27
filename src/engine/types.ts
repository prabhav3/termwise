// Engine input/output contracts. The engine is pure TypeScript: no React Native, no Supabase,
// no Date.now() (callers pass `today`), no imports from outside src/engine. Input interfaces are
// structural subsets of the DB rows in src/types/db.ts, so full rows can be passed directly.

export type ISODate = string; // YYYY-MM-DD, a local calendar date
export type ItemKind =
  | 'exam'
  | 'quiz'
  | 'paper'
  | 'project'
  | 'homework'
  | 'reading'
  | 'presentation'
  | 'lab'
  | 'discussion'
  | 'other';
export type ItemStatus = 'todo' | 'in_progress' | 'done' | 'missed';
export type BlockKind = 'reading' | 'work' | 'milestone' | 'study' | 'review';
export type BlockStatus = 'planned' | 'done' | 'missed' | 'skipped';

export interface GradeCutoff {
  letter: string;
  min: number;
}

export interface EngineCourse {
  id: string;
  title: string;
  code: string | null;
  color: string;
  credits: number | null;
  meeting_days: number[];
  start_date: ISODate | null;
  end_date: ISODate | null;
  target_percent: number | null;
  grade_scale: GradeCutoff[];
  policies: { unannounced_quizzes?: boolean } & Record<string, unknown>;
  archived?: boolean;
}

export interface EngineComponent {
  id: string;
  course_id: string;
  name: string;
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
}

export interface EngineReading {
  textbook_id: string | null;
  chapters: string[];
  page_ranges: { start: number; end: number }[];
  explicit_pages: number | null;
  description: string | null;
}

export interface EngineItem {
  id: string;
  course_id: string;
  component_id: string | null;
  title: string;
  kind: ItemKind;
  assigned_date: ISODate | null;
  due_date: ISODate | null;
  due_time: string | null;
  weight_override: number | null;
  points_possible: number | null;
  score: number | null;
  estimated_minutes: number | null;
  reading: EngineReading | null;
  pages: number | null;
  status: ItemStatus;
  high_impact_override: boolean | null;
  is_major: boolean;
}

export interface EngineTextbook {
  id: string;
  course_id: string;
  title: string;
  chapters: { number: string; title: string | null; start_page: number | null; end_page: number | null }[];
}

export interface EngineTermEvent {
  id: string;
  course_id: string | null;
  title: string;
  kind: 'holiday' | 'break' | 'no_class' | 'finals_period' | 'add_drop' | 'other';
  start_date: ISODate;
  end_date: ISODate;
}

/** A unit of planned work on one day. `key` is unique within a plan and stable across replans where possible. */
export interface EngineBlock {
  /** DB id when the block came from the database; absent for newly generated blocks. */
  id?: string;
  key: string;
  item_id: string;
  course_id: string;
  date: ISODate;
  minutes: number;
  kind: BlockKind;
  label: string;
  page_start: number | null;
  page_end: number | null;
  status: BlockStatus;
  sort_order: number;
  generated_by?: 'engine' | 'manual';
}

export interface PlannerSettings {
  /** The student's local "today". The engine never reads the clock. */
  today: ISODate;
  /** 0 = Sunday ... 6 = Saturday */
  study_days: number[];
  daily_capacity_minutes: number;
  reading_pages_per_hour: number;
  default_pages_per_chapter: number;
  /** Percent of course grade at/above which an item is high impact (default 15). */
  high_impact_threshold: number;
  /** Extra days with no planned work (student-chosen). Holidays from term events are NOT auto-blacked-out. */
  blackout_dates: ISODate[];
}

export interface PlanInput {
  courses: EngineCourse[];
  components: EngineComponent[];
  items: EngineItem[];
  textbooks: EngineTextbook[];
  termEvents: EngineTermEvent[];
  /** Every block currently stored for the student (any status, any date). */
  existingBlocks: EngineBlock[];
  settings: PlannerSettings;
}

export interface ImpactInfo {
  /** Effective percent of the course grade this item is worth, or null if unknown. */
  weight: number | null;
  /** 0-100 priority-style score blending grade weight, kind, and course credits. */
  score: number;
  isHighImpact: boolean;
  /** Human-readable reasons, e.g. ["Worth 25% of PSY 101", "Final exam"]. */
  reasons: string[];
}

export interface AnnotatedItem extends EngineItem {
  impact: ImpactInfo;
  /** Resolved total pages for readings (null when not a reading or unknown). */
  resolvedPages: number | null;
  /** Total estimated work minutes (reading minutes derive from pages / reading speed). */
  effortMinutes: number;
}

export interface DayLoad {
  date: ISODate;
  /** Planned (not done/missed/skipped) minutes. */
  minutes: number;
  doneMinutes: number;
  capacity: number;
  pages: number;
  blockCount: number;
  overloaded: boolean;
  isStudyDay: boolean;
}

export interface OverflowWarning {
  item_id: string;
  /** Minutes that could not be placed within capacity before the deadline. */
  unplacedMinutes: number;
  message: string;
  suggestion: string;
}

export interface PlanResult {
  /**
   * The complete block set the app should persist: every existing done/missed/skipped/manual block
   * (unchanged, except past-dated `planned` blocks which come back as `missed`), plus freshly
   * generated `planned` blocks dated today or later. Engine-generated planned blocks from the
   * input that are dated today or later are replaced.
   */
  blocks: EngineBlock[];
  days: DayLoad[];
  overflow: OverflowWarning[];
  annotated: AnnotatedItem[];
}

export interface RescheduleResult extends PlanResult {
  /** What happened to the missed work, for a toast: "Spread 40 pages across Wed-Fri". */
  summary: string;
  moved: { key: string; date: ISODate; minutes: number }[];
}

export type StressLevel = 'calm' | 'busy' | 'heavy' | 'red';

export interface RedZoneItem {
  id: string;
  course_id: string;
  title: string;
  kind: ItemKind;
  due_date: ISODate;
}

export interface RedZone {
  start: ISODate;
  end: ISODate;
  severity: 'red' | 'orange';
  items: RedZoneItem[];
  courseIds: string[];
  /** e.g. "3 major deadlines in 48 hours across PSY 101, HIST 210" */
  message: string;
}

export interface WeekStress {
  week_start: ISODate; // Monday
  week_end: ISODate; // Sunday
  score: number; // 0-100
  level: StressLevel;
  deadlines: number;
  majorDeadlines: number;
  plannedMinutes: number;
  capacityMinutes: number;
  redZones: RedZone[];
  drivers: string[];
}

export interface TriageAction {
  key: string;
  item_id: string;
  block_key: string | null;
  course_id: string;
  title: string;
  subtitle: string;
  minutes: number;
  priority: number;
  reason: 'overdue' | 'due_today' | 'due_soon' | 'planned_today' | 'high_impact' | 'red_zone_prep';
}

export interface FocusTask {
  block_key: string;
  item_id: string;
  course_id: string;
  /** e.g. "Study 25 mins for PSY 101 Quiz 1" */
  label: string;
  minutes: number;
}

export interface PomodoroSegment {
  kind: 'focus' | 'short_break' | 'long_break';
  minutes: number;
}

export interface ComponentGrade {
  component_id: string;
  name: string;
  weight: number;
  /** Current percent across graded items (after drops), null if nothing graded. */
  percent: number | null;
  gradedCount: number;
  totalCount: number;
  droppedItemIds: string[];
}

export interface CourseGrade {
  /** Weighted percent over graded components only; null if nothing graded. */
  percent: number | null;
  letter: string | null;
  /** Sum of component weights that have at least one graded item. */
  gradedWeight: number;
  totalWeight: number;
  /** Final percent if every remaining item scored 0 / 100. */
  projectedMin: number | null;
  projectedMax: number | null;
  components: ComponentGrade[];
}

export type OtherWorkAssumption = 'current_average' | 'zero' | 'perfect';

export interface RequiredScore {
  item_id: string;
  targetPercent: number;
  /** Percent needed on the item; null when no score can change the outcome or inputs are missing. */
  neededPercent: number | null;
  achievable: boolean;
  alreadySecured: boolean;
  explanation: string;
}

export interface MasterCalendarEvent {
  date: ISODate;
  end_date: ISODate;
  type: 'item' | 'term_event';
  id: string;
  course_id: string | null;
  title: string;
  kind: string;
  isHighImpact: boolean;
}

export interface CalendarConflict {
  kind: 'same_day_majors' | 'due_on_holiday' | 'outside_course_dates' | 'unscheduled';
  date: ISODate | null;
  item_ids: string[];
  message: string;
}

export interface MasterCalendar {
  start: ISODate | null;
  end: ISODate | null;
  events: MasterCalendarEvent[];
  /** Term events deduped across syllabi (e.g. Thanksgiving break listed by 4 courses -> 1). */
  termEvents: EngineTermEvent[];
  conflicts: CalendarConflict[];
}
