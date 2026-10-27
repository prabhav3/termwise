// Which Termwise course a Canvas course imports into: an explicit link, the earlier link, or a
// new course built from the Canvas course details.
import { utcToLocal } from '../_shared/calendar-model.ts';
import type { CanvasCourse } from '../_shared/canvas-client.ts';
import { HttpError } from '../_shared/http.ts';
import { COURSE_COLUMNS, type CourseRow, type Db, dbFail, type LmsCourseRow } from './rows.ts';

/** docs/DESIGN.md courseColors, assigned in creation order. */
const COURSE_COLORS = ['#4D96FF', '#FF6B9D', '#FFD23F', '#3DDC97', '#FF8A3D', '#9B5DE5', '#00C2C7', '#C6F432'];

export interface TargetRequest {
  link_course_id: string | null;
  term_id: string | null;
}

async function findCourse(userDb: Db, courseId: string): Promise<CourseRow | null> {
  const { data, error } = await userDb
    .from('courses')
    .select(COURSE_COLUMNS)
    .eq('id', courseId)
    .maybeSingle()
    .overrideTypes<CourseRow, { merge: false }>();
  if (error) dbFail('course lookup', error);
  return data;
}

function localDate(instant: string | null | undefined, timeZone: string): string | null {
  return instant && Number.isFinite(Date.parse(instant)) ? utcToLocal(instant, timeZone).date : null;
}

function courseDetails(course: CanvasCourse, timeZone: string) {
  let start = localDate(course.start_at ?? course.term?.start_at, timeZone);
  let end = localDate(course.end_at ?? course.term?.end_at, timeZone);
  if (start && end && start > end) [start, end] = [null, null];
  return {
    title: (course.name ?? '').trim().slice(0, 200) || 'Canvas course',
    code: course.course_code?.trim().slice(0, 40) || null,
    start_date: start,
    end_date: end,
  };
}

function termFailure(error: { code?: string } | null): never {
  // RLS rejects a term_id that isn't the student's own.
  if (error?.code === '42501' || error?.code === '23503') throw new HttpError('bad_request', 'That term no longer exists.');
  dbFail('course save', error);
}

/** Fills only what the syllabus left empty and records the Canvas link. */
async function linkExisting(userDb: Db, course: CourseRow, canvas: CanvasCourse, request: TargetRequest, timeZone: string): Promise<void> {
  const details = courseDetails(canvas, timeZone);
  const patch: Record<string, unknown> = {};
  if (course.canvas_course_id !== String(canvas.id)) patch.canvas_course_id = String(canvas.id);
  if (!course.code && details.code) patch.code = details.code;
  if (!course.start_date && !course.end_date && details.start_date && details.end_date) {
    patch.start_date = details.start_date;
    patch.end_date = details.end_date;
  }
  if (!course.term_id && request.term_id) patch.term_id = request.term_id;
  if (Object.keys(patch).length === 0) return;
  const { error } = await userDb.from('courses').update(patch).eq('id', course.id);
  if (error) termFailure(error);
}

async function createCourse(userDb: Db, canvas: CanvasCourse, request: TargetRequest, timeZone: string): Promise<string> {
  const { count, error: countError } = await userDb.from('courses').select('id', { count: 'exact', head: true });
  if (countError) dbFail('course count', countError);
  const { data, error } = await userDb
    .from('courses')
    .insert({
      ...courseDetails(canvas, timeZone),
      term_id: request.term_id,
      canvas_course_id: String(canvas.id),
      color: COURSE_COLORS[(count ?? 0) % COURSE_COLORS.length],
    })
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (error || !data) termFailure(error);
  return data.id;
}

/** Returns the Termwise course id for this Canvas course, creating the course when needed. */
export async function resolveTargetCourse(
  userDb: Db,
  canvas: CanvasCourse,
  lmsCourse: LmsCourseRow,
  request: TargetRequest,
  timeZone: string,
): Promise<{ courseId: string; created: boolean }> {
  if (request.link_course_id) {
    const course = await findCourse(userDb, request.link_course_id);
    if (!course) throw new HttpError('not_found', 'That Termwise course no longer exists.');
    await linkExisting(userDb, course, canvas, request, timeZone);
    return { courseId: course.id, created: false };
  }
  if (lmsCourse.linked_course_id) {
    const course = await findCourse(userDb, lmsCourse.linked_course_id);
    if (course) {
      await linkExisting(userDb, course, canvas, request, timeZone);
      return { courseId: course.id, created: false };
    }
  }
  const { data, error } = await userDb
    .from('courses')
    .select(COURSE_COLUMNS)
    .eq('canvas_course_id', String(canvas.id))
    .eq('archived', false)
    .limit(1)
    .overrideTypes<CourseRow[], { merge: false }>();
  if (error) dbFail('course lookup', error);
  if (data && data.length > 0) {
    await linkExisting(userDb, data[0], canvas, request, timeZone);
    return { courseId: data[0].id, created: false };
  }
  return { courseId: await createCourse(userDb, canvas, request, timeZone), created: true };
}

/** Marks the Canvas course as imported into `courseId` (service role: lms_courses has no insert policy). */
export async function linkLmsCourse(adminDb: Db, lmsCourseId: string, courseId: string, syncedAt: string): Promise<void> {
  const { error } = await adminDb
    .from('lms_courses')
    .update({ linked_course_id: courseId, sync_enabled: true, last_synced_at: syncedAt })
    .eq('id', lmsCourseId);
  if (error) dbFail('course link', error);
}
