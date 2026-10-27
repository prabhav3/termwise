// Row types for every table in supabase/migrations/20261027000000_init.sql.
// Field names are the exact snake_case column names so rows flow from supabase-js into the
// engine (src/engine) without a mapping layer. Keep this file in lockstep with the migrations.

export type UUID = string;
/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Local wall-clock time, `HH:MM` or `HH:MM:SS` (Postgres `time`). */
export type ISOTime = string;
/** Instant, ISO-8601 with offset (Postgres `timestamptz`). */
export type Timestamp = string;

export const ITEM_KINDS = [
  'exam',
  'quiz',
  'paper',
  'project',
  'homework',
  'reading',
  'presentation',
  'lab',
  'discussion',
  'other',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemStatus = 'todo' | 'in_progress' | 'done' | 'missed';
export type RowSource = 'ai' | 'manual' | 'shared' | 'canvas' | 'lms';
export type BlockKind = 'reading' | 'work' | 'milestone' | 'study' | 'review';
export type BlockStatus = 'planned' | 'done' | 'missed' | 'skipped';
export type TermEventKind = 'holiday' | 'break' | 'no_class' | 'finals_period' | 'add_drop' | 'other';
export type UploadStatus = 'uploaded' | 'processing' | 'needs_review' | 'imported' | 'failed';
export type CalendarProvider = 'google' | 'microsoft' | 'apple';
export type CalendarDelivery = 'all_day_event' | 'task';
export type ConnectionStatus = 'active' | 'needs_reauth' | 'disconnected';
export type LmsProvider = 'canvas' | 'moodle' | 'blackboard' | 'ics';
export type DiscrepancyKind =
  | 'date_mismatch'
  | 'missing_in_lms'
  | 'missing_in_syllabus'
  | 'locks_before_due'
  | 'weight_mismatch'
  | 'points_mismatch';

export interface GradeCutoff {
  letter: string;
  /** Minimum percent (0-100) for this letter. */
  min: number;
}

export interface CoursePolicies {
  late_policy?: string | null;
  unannounced_quizzes?: boolean;
  attendance_policy?: string | null;
  drop_policy?: string | null;
  extra_credit?: string | null;
}

export interface Chapter {
  number: string;
  title: string | null;
  start_page: number | null;
  end_page: number | null;
}

export interface PageRange {
  start: number;
  end: number;
}

export interface ReadingRef {
  textbook_id: UUID | null;
  chapters: string[];
  page_ranges: PageRange[];
  explicit_pages: number | null;
  description: string | null;
}

export interface ExternalChange {
  provider: CalendarProvider;
  new_due_date: ISODate | null;
  new_due_time: ISOTime | null;
  detected_at: Timestamp;
  /** true when the student deleted the event in their calendar app */
  deleted?: boolean;
}

export interface Profile {
  id: UUID;
  display_name: string | null;
  timezone: string;
  study_days: number[];
  daily_capacity_minutes: number;
  reading_pages_per_hour: number;
  default_pages_per_chapter: number;
  high_impact_threshold: number;
  blackout_dates: ISODate[];
  triage_notification_time: ISOTime;
  notifications_enabled: boolean;
  pomodoro_focus_minutes: number;
  pomodoro_break_minutes: number;
  ics_token: UUID;
  onboarded_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Term {
  id: UUID;
  user_id: UUID;
  name: string;
  start_date: ISODate | null;
  end_date: ISODate | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Course {
  id: UUID;
  user_id: UUID;
  term_id: UUID | null;
  code: string | null;
  title: string;
  section: string | null;
  instructor: string | null;
  instructor_email: string | null;
  color: string;
  credits: number | null;
  meeting_days: number[];
  meeting_start: ISOTime | null;
  meeting_end: ISOTime | null;
  location: string | null;
  start_date: ISODate | null;
  end_date: ISODate | null;
  target_percent: number | null;
  grade_scale: GradeCutoff[];
  policies: CoursePolicies;
  canvas_course_id: string | null;
  shared_from_slug: string | null;
  archived: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TermEvent {
  id: UUID;
  user_id: UUID;
  term_id: UUID | null;
  course_id: UUID | null;
  title: string;
  kind: TermEventKind;
  start_date: ISODate;
  end_date: ISODate;
  source: 'ai' | 'manual' | 'shared' | 'canvas';
  created_at: Timestamp;
}

export interface GradingComponent {
  id: UUID;
  user_id: UUID;
  course_id: UUID;
  name: string;
  /** Percent of the course grade, 0-100. */
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
  source: 'ai' | 'manual' | 'shared' | 'canvas';
  canvas_group_id: string | null;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Textbook {
  id: UUID;
  user_id: UUID;
  course_id: UUID;
  title: string;
  authors: string | null;
  chapters: Chapter[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Item {
  id: UUID;
  user_id: UUID;
  course_id: UUID;
  component_id: UUID | null;
  title: string;
  kind: ItemKind;
  description: string | null;
  assigned_date: ISODate | null;
  due_date: ISODate | null;
  due_time: ISOTime | null;
  /** Explicit percent of course grade, when the syllabus states it for this item. */
  weight_override: number | null;
  points_possible: number | null;
  score: number | null;
  estimated_minutes: number | null;
  reading: ReadingRef | null;
  pages: number | null;
  status: ItemStatus;
  high_impact_override: boolean | null;
  is_major: boolean;
  source: RowSource;
  confidence: number | null;
  source_quote: string | null;
  notes: string | null;
  canvas_assignment_id: string | null;
  lms_due_at: Timestamp | null;
  lms_lock_at: Timestamp | null;
  lms_unlock_at: Timestamp | null;
  external_change: ExternalChange | null;
  completed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UploadFile {
  /** Storage object path inside the `syllabi` bucket: `<user_id>/<upload_id>/<n>.<ext>` */
  path: string;
  mime: string;
  name: string;
  size: number;
}

export interface SyllabusUpload {
  id: UUID;
  user_id: UUID;
  course_id: UUID | null;
  kind: 'syllabus' | 'toc';
  source: 'upload' | 'paste' | 'canvas';
  files: UploadFile[];
  pasted_text: string | null;
  status: UploadStatus;
  progress_note: string | null;
  error: string | null;
  /** SyllabusExtraction | TocExtraction — see supabase/functions/_shared/extraction.ts */
  extraction: unknown;
  model: string | null;
  usage: unknown;
  processing_started_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PlanBlock {
  id: UUID;
  user_id: UUID;
  item_id: UUID;
  course_id: UUID;
  key: string;
  date: ISODate;
  minutes: number;
  kind: BlockKind;
  label: string;
  page_start: number | null;
  page_end: number | null;
  status: BlockStatus;
  sort_order: number;
  generated_by: 'engine' | 'manual';
  completed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FocusSession {
  id: UUID;
  user_id: UUID;
  item_id: UUID | null;
  plan_block_id: UUID | null;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  planned_minutes: number | null;
  focused_minutes: number;
  completed: boolean;
  created_at: Timestamp;
}

export interface CalendarConnection {
  id: UUID;
  user_id: UUID;
  provider: CalendarProvider;
  account_email: string | null;
  external_calendar_id: string | null;
  task_list_id: string | null;
  delivery: CalendarDelivery;
  sync_plan_blocks: boolean;
  device_id: string;
  status: ConnectionStatus;
  sync_cursor: string | null;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CalendarEventLink {
  id: UUID;
  user_id: UUID;
  connection_id: UUID;
  /** `item:<item uuid>` or `block:<plan_blocks.key>` */
  key: string;
  external_id: string;
  external_kind: 'event' | 'task';
  pushed_hash: string | null;
  pushed_date: ISODate | null;
  last_seen_at: Timestamp | null;
  created_at: Timestamp;
}

export interface LmsConnection {
  id: UUID;
  user_id: UUID;
  provider: LmsProvider;
  base_url: string;
  display_name: string | null;
  external_user_id: string | null;
  status: ConnectionStatus;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface LmsCourse {
  id: UUID;
  user_id: UUID;
  connection_id: UUID;
  external_id: string;
  name: string;
  course_code: string | null;
  term_name: string | null;
  start_at: Timestamp | null;
  end_at: Timestamp | null;
  has_syllabus: boolean;
  linked_course_id: UUID | null;
  sync_enabled: boolean;
  last_synced_at: Timestamp | null;
  created_at: Timestamp;
}

export interface LmsDiscrepancy {
  id: UUID;
  user_id: UUID;
  connection_id: UUID | null;
  course_id: UUID;
  item_id: UUID | null;
  kind: DiscrepancyKind;
  title: string;
  detail: string | null;
  syllabus_value: string | null;
  lms_value: string | null;
  lms_external_id: string | null;
  dedupe_key: string;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: Timestamp;
  updated_at: Timestamp;
  resolved_at: Timestamp | null;
}

export interface SharedTimeline {
  id: UUID;
  owner_id: UUID;
  course_id: UUID;
  slug: string;
  snapshot: SharedSnapshot;
  revoked: boolean;
  import_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Shape produced by public.create_share_link() — no scores, statuses, or notes. */
export interface SharedSnapshot {
  version: 1;
  course: Pick<
    Course,
    | 'title'
    | 'code'
    | 'section'
    | 'instructor'
    | 'credits'
    | 'color'
    | 'meeting_days'
    | 'meeting_start'
    | 'meeting_end'
    | 'location'
    | 'start_date'
    | 'end_date'
    | 'grade_scale'
    | 'policies'
  >;
  components: { ref: UUID; name: string; weight: number; expected_count: number | null; drop_lowest: number }[];
  textbooks: { ref: UUID; title: string; authors: string | null; chapters: Chapter[] }[];
  items: (Pick<
      Item,
      | 'title'
      | 'kind'
      | 'description'
      | 'assigned_date'
      | 'due_date'
      | 'due_time'
      | 'weight_override'
      | 'points_possible'
      | 'estimated_minutes'
      | 'reading'
      | 'pages'
      | 'is_major'
    > & { component_ref: UUID | null })[];
  term_events: Pick<TermEvent, 'title' | 'kind' | 'start_date' | 'end_date'>[];
}

/** Return value of rpc('get_shared_timeline'). */
export interface SharedTimelinePublic {
  slug: string;
  snapshot: SharedSnapshot;
  import_count: number;
  updated_at: Timestamp;
}

/** Insert payloads: server-defaulted columns become optional. */
export type Insert<T> = Omit<T, 'id' | 'user_id' | 'created_at' | 'updated_at'> &
  Partial<Pick<T & { id: UUID }, 'id'>>;
