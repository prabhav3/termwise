// Column lists and row shapes this function reads (subsets of src/types/db.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../_shared/http.ts';

export type Db = SupabaseClient;

export const CONNECTION_COLUMNS = 'id, user_id, provider, base_url, display_name, status';
export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: 'canvas' | 'moodle' | 'blackboard' | 'ics';
  base_url: string;
  display_name: string | null;
  status: 'active' | 'needs_reauth' | 'disconnected';
}

export const LMS_COURSE_COLUMNS = 'id, external_id, name, course_code, term_name, start_at, end_at, has_syllabus, linked_course_id, sync_enabled';
export interface LmsCourseRow {
  id: string;
  external_id: string;
  name: string;
  course_code: string | null;
  term_name: string | null;
  start_at: string | null;
  end_at: string | null;
  has_syllabus: boolean;
  linked_course_id: string | null;
  sync_enabled: boolean;
}

export const COURSE_COLUMNS = 'id, code, title, start_date, end_date, term_id, canvas_course_id';
export interface CourseRow {
  id: string;
  code: string | null;
  title: string;
  start_date: string | null;
  end_date: string | null;
  term_id: string | null;
  canvas_course_id: string | null;
}

export const COMPONENT_COLUMNS = 'id, course_id, name, weight, expected_count, drop_lowest, source, canvas_group_id, sort_order';
export interface ComponentRow {
  id: string;
  course_id: string;
  name: string;
  weight: number;
  expected_count: number | null;
  drop_lowest: number;
  source: 'ai' | 'manual' | 'shared' | 'canvas';
  canvas_group_id: string | null;
  sort_order: number;
}

export const ITEM_COLUMNS =
  'id, course_id, component_id, title, kind, description, assigned_date, due_date, due_time, points_possible, score, status, is_major, source, canvas_assignment_id, lms_due_at, lms_lock_at, lms_unlock_at, completed_at';
export interface ItemRow {
  id: string;
  course_id: string;
  component_id: string | null;
  title: string;
  kind: string;
  description: string | null;
  assigned_date: string | null;
  due_date: string | null;
  due_time: string | null;
  points_possible: number | null;
  score: number | null;
  status: 'todo' | 'in_progress' | 'done' | 'missed';
  is_major: boolean;
  source: 'ai' | 'manual' | 'shared' | 'canvas' | 'lms';
  canvas_assignment_id: string | null;
  lms_due_at: string | null;
  lms_lock_at: string | null;
  lms_unlock_at: string | null;
  completed_at: string | null;
}

/** Items that came from the student's syllabus side (not created by an LMS import). */
export function isSyllabusSourced(item: Pick<ItemRow, 'source'>): boolean {
  return item.source === 'ai' || item.source === 'manual' || item.source === 'shared';
}

/** Logs the Postgres error code (never row contents) and throws a safe 500. */
export function dbFail(context: string, error: { code?: string; message?: string } | null): never {
  console.error(`canvas: ${context} failed (${error?.code ?? 'unknown'})`);
  throw new HttpError('internal', 'Something went wrong saving your Canvas data. Please try again.');
}
