// supabase-js schema typing derived from the row contracts in src/types/db.ts, so every
// `supabase.from(...)` call is checked against the real columns. Insert types require only the
// columns that are NOT NULL without a default in the migration; everything else is optional.
import type {
  CalendarConnection,
  CalendarEventLink,
  Course,
  FocusSession,
  GradingComponent,
  Item,
  LmsConnection,
  LmsCourse,
  LmsDiscrepancy,
  PlanBlock,
  Profile,
  SharedTimeline,
  SyllabusUpload,
  Term,
  TermEvent,
  Textbook,
  UUID,
} from '@/types/db';

/** Interfaces lack index signatures; a mapped copy satisfies supabase-js' Record<string, unknown> bound. */
type Plain<T> = { [K in keyof T]: T[K] };

type Table<Row, Required extends keyof Row> = {
  Row: Plain<Row>;
  Insert: Plain<Pick<Row, Required> & Partial<Omit<Row, Required>>>;
  Update: Plain<Partial<Row>>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile, 'id'>;
      terms: Table<Term, 'name'>;
      courses: Table<Course, 'title'>;
      term_events: Table<TermEvent, 'title' | 'start_date' | 'end_date'>;
      grading_components: Table<GradingComponent, 'course_id' | 'name' | 'weight'>;
      textbooks: Table<Textbook, 'course_id' | 'title'>;
      items: Table<Item, 'course_id' | 'title'>;
      syllabus_uploads: Table<SyllabusUpload, never>;
      plan_blocks: Table<PlanBlock, 'item_id' | 'course_id' | 'key' | 'date' | 'minutes' | 'kind' | 'label'>;
      focus_sessions: Table<FocusSession, never>;
      calendar_connections: Table<CalendarConnection, 'provider'>;
      calendar_event_links: Table<CalendarEventLink, 'connection_id' | 'key' | 'external_id'>;
      lms_connections: Table<LmsConnection, 'provider' | 'base_url'>;
      lms_courses: Table<LmsCourse, 'connection_id' | 'external_id' | 'name'>;
      lms_discrepancies: Table<LmsDiscrepancy, 'course_id' | 'kind' | 'title' | 'dedupe_key'>;
      shared_timelines: Table<SharedTimeline, 'course_id' | 'snapshot'>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_share_link: { Args: { p_course_id: UUID }; Returns: Plain<SharedTimeline> };
      /** SharedTimelinePublic, or null when the slug is unknown or revoked. */
      get_shared_timeline: { Args: { p_slug: string }; Returns: unknown };
      import_shared_timeline: { Args: { p_slug: string; p_term_id?: UUID | null }; Returns: UUID };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

export type TableName = keyof Database['public']['Tables'];
export type InsertRow<T extends TableName> = Database['public']['Tables'][T]['Insert'];
export type UpdateRow<T extends TableName> = Database['public']['Tables'][T]['Update'];
