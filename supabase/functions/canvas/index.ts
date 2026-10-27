// canvas (auth: user) — Canvas LMS as a first-class source. POST CanvasRequest
// (supabase/functions/_shared/api.ts):
//   connect        validate the personal access token, store it encrypted, list active courses
//   list_courses   re-pull the active course list
//   import         create or link Termwise courses and pull groups, assignments, and scores
//   sync           re-pull every linked course
//   fetch_syllabus copy the Canvas syllabus page into a syllabus_uploads row for parse-syllabus
//   disconnect     delete the connection (secrets, course list, and discrepancies cascade)
// Connection and secret rows are written with the service role (students can't insert them);
// everything course-scoped goes through the caller's RLS-bound client.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type {
  CanvasConnectResponse,
  CanvasFetchSyllabusResponse,
  CanvasImportResponse,
  CanvasListCoursesResponse,
  CanvasRequest,
  CanvasSyncResponse,
  OkResponse,
} from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { mapLimit } from '../_shared/calendar-model.ts';
import { type CanvasCourse, CanvasError, hasSyllabusContent, normalizeCanvasBaseUrl } from '../_shared/canvas-client.ts';
import { countOpenDiscrepancies } from '../_shared/discrepancy-store.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { SafeFetchError } from '../_shared/safe-fetch.ts';
import {
  clientForConnection,
  loadConnection,
  newCanvasClient,
  profileTimeZone,
  refreshCourseList,
  sealToken,
  setStatus,
  toHttpError,
  upsertLmsCourses,
} from './connection.ts';
import { type CourseSyncCounts, type SyncContext, syncCanvasCourse } from './course-sync.ts';
import { linkLmsCourse, resolveTargetCourse } from './courses.ts';
import { parseCanvasRequest } from './requests.ts';
import { type Db, dbFail, LMS_COURSE_COLUMNS, type LmsCourseRow } from './rows.ts';

/** Canvas courses pulled in parallel; Canvas throttles per token, so keep this small. */
const COURSE_CONCURRENCY = 2;
/** Syllabus pages with embedded images can be huge; the parser needs the text, not megabytes. */
const MAX_SYLLABUS_CHARS = 400_000;

type Action<A extends CanvasRequest['action']> = Extract<CanvasRequest, { action: A }>;

interface Caller {
  userId: string;
  userDb: Db;
  adminDb: Db;
}

/** Runs Canvas work and maps Canvas / network failures to ApiErrors (marking dead tokens). */
async function withCanvasErrors<T>(caller: Caller, connectionId: string | null, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw await toHttpError(err, caller.adminDb, connectionId);
  }
}

async function connect(caller: Caller, request: Action<'connect'>): Promise<CanvasConnectResponse> {
  let baseUrl: string;
  try {
    baseUrl = normalizeCanvasBaseUrl(request.base_url);
  } catch (err) {
    if (err instanceof SafeFetchError) throw new HttpError('bad_request', err.message);
    throw err;
  }
  const client = newCanvasClient(baseUrl, request.access_token);
  const { self, courses } = await withCanvasErrors(caller, null, async () => {
    try {
      return { self: await client.getSelf(), courses: await client.listActiveCourses() };
    } catch (err) {
      if (err instanceof CanvasError && err.status === 401) {
        throw new HttpError('upstream_auth', "Canvas didn't accept that access token. Copy a new one from Canvas → Account → Settings.");
      }
      if (err instanceof CanvasError && err.kind === 'not_found') {
        throw new HttpError('bad_request', "That address doesn't look like a Canvas site. Use the address you sign in to Canvas with.");
      }
      throw err;
    }
  });

  const { data: connection, error } = await caller.adminDb
    .from('lms_connections')
    .upsert(
      {
        user_id: caller.userId,
        provider: 'canvas',
        base_url: baseUrl,
        display_name: self.name?.trim() || null,
        external_user_id: String(self.id),
        status: 'active',
        last_error: null,
      },
      { onConflict: 'user_id,provider,base_url' },
    )
    .select('id, display_name')
    .single()
    .overrideTypes<{ id: string; display_name: string | null }, { merge: false }>();
  if (error || !connection) dbFail('connection save', error);

  const { error: secretError } = await caller.adminDb.from('lms_secrets').upsert(
    {
      connection_id: connection.id,
      user_id: caller.userId,
      token_enc: await sealToken(request.access_token),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'connection_id' },
  );
  if (secretError) dbFail('token save', secretError);

  const summaries = await refreshCourseList(caller.adminDb, caller.userId, connection.id, courses);
  return { connection_id: connection.id, display_name: connection.display_name, courses: summaries };
}

async function listCourses(caller: Caller, request: Action<'list_courses'>): Promise<CanvasListCoursesResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const client = await clientForConnection(caller.adminDb, connection);
  const courses = await withCanvasErrors(caller, connection.id, () => client.listActiveCourses());
  return { courses: await refreshCourseList(caller.adminDb, caller.userId, connection.id, courses) };
}

function addCounts(total: CourseSyncCounts, part: CourseSyncCounts): CourseSyncCounts {
  return {
    components_created: total.components_created + part.components_created,
    items_created: total.items_created + part.items_created,
    items_updated: total.items_updated + part.items_updated,
  };
}

async function importCourses(caller: Caller, request: Action<'import'>): Promise<CanvasImportResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const client = await clientForConnection(caller.adminDb, connection);
  const timeZone = await profileTimeZone(caller.userDb, caller.userId);
  const ctx: SyncContext = { ...caller, connectionId: connection.id, client, timeZone, includeScores: request.include_scores ?? true };

  const imported = await withCanvasErrors(caller, connection.id, () =>
    mapLimit(request.courses, COURSE_CONCURRENCY, async (entry) => {
      const canvasCourse = await client.getCourse(entry.external_id);
      const [lmsCourse] = await upsertLmsCourses(caller.adminDb, caller.userId, connection.id, [canvasCourse]);
      const target = await resolveTargetCourse(
        caller.userDb,
        canvasCourse,
        lmsCourse,
        { link_course_id: entry.link_course_id ?? null, term_id: entry.term_id ?? null },
        timeZone,
      );
      const counts = await syncCanvasCourse(ctx, canvasCourse, target.courseId);
      await linkLmsCourse(caller.adminDb, lmsCourse.id, target.courseId, new Date().toISOString());
      return { external_id: entry.external_id, course_id: target.courseId, ...counts };
    }),
  );
  await setStatus(caller.adminDb, connection.id, 'active', null, new Date().toISOString());
  return { imported, discrepancies_open: await countOpenDiscrepancies(caller.userDb, connection.id) };
}

async function sync(caller: Caller, request: Action<'sync'>): Promise<CanvasSyncResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const client = await clientForConnection(caller.adminDb, connection);
  const timeZone = await profileTimeZone(caller.userDb, caller.userId);
  const ctx: SyncContext = { ...caller, connectionId: connection.id, client, timeZone, includeScores: true };

  const { data, error } = await caller.userDb
    .from('lms_courses')
    .select(LMS_COURSE_COLUMNS)
    .eq('connection_id', connection.id)
    .eq('sync_enabled', true)
    .not('linked_course_id', 'is', null)
    .overrideTypes<LmsCourseRow[], { merge: false }>();
  if (error) dbFail('linked course lookup', error);
  const linked = data ?? [];

  let skipped = 0;
  const results = await withCanvasErrors(caller, connection.id, () =>
    mapLimit(linked, COURSE_CONCURRENCY, async (row): Promise<CourseSyncCounts | null> => {
      let canvasCourse: CanvasCourse;
      try {
        canvasCourse = await client.getCourse(row.external_id);
      } catch (err) {
        // The course ended or was unpublished: keep syncing the others.
        if (err instanceof CanvasError && (err.kind === 'not_found' || err.kind === 'forbidden')) {
          skipped++;
          return null;
        }
        throw err;
      }
      await upsertLmsCourses(caller.adminDb, caller.userId, connection.id, [canvasCourse]);
      const counts = await syncCanvasCourse(ctx, canvasCourse, row.linked_course_id as string);
      await linkLmsCourse(caller.adminDb, row.id, row.linked_course_id as string, new Date().toISOString());
      return counts;
    }),
  );

  const totals = results.reduce<CourseSyncCounts>((sum, r) => (r ? addCounts(sum, r) : sum), {
    components_created: 0,
    items_created: 0,
    items_updated: 0,
  });
  const note = skipped > 0 ? `Canvas no longer shows ${skipped} linked course${skipped === 1 ? '' : 's'}.` : null;
  await setStatus(caller.adminDb, connection.id, 'active', note, new Date().toISOString());
  return {
    synced_courses: results.filter((r) => r !== null).length,
    items_created: totals.items_created,
    items_updated: totals.items_updated,
    discrepancies_open: await countOpenDiscrepancies(caller.userDb, connection.id),
  };
}

async function fetchSyllabus(caller: Caller, request: Action<'fetch_syllabus'>): Promise<CanvasFetchSyllabusResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const client = await clientForConnection(caller.adminDb, connection);
  const canvasCourse = await withCanvasErrors(caller, connection.id, () => client.getCourse(request.external_id));
  const [lmsCourse] = await upsertLmsCourses(caller.adminDb, caller.userId, connection.id, [canvasCourse]);
  const html = canvasCourse.syllabus_body ?? '';
  if (!hasSyllabusContent(html)) return { upload_id: null };

  // User client: RLS checks that the linked course is the caller's own.
  const { data, error } = await caller.userDb
    .from('syllabus_uploads')
    .insert({
      course_id: lmsCourse.linked_course_id,
      kind: 'syllabus',
      source: 'canvas',
      files: [],
      pasted_text: html.slice(0, MAX_SYLLABUS_CHARS),
      status: 'uploaded',
    })
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (error || !data) dbFail('syllabus copy', error);
  return { upload_id: data.id };
}

async function disconnect(caller: Caller, request: Action<'disconnect'>): Promise<OkResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const { error } = await caller.userDb.from('lms_connections').delete().eq('id', connection.id);
  if (error) dbFail('disconnect', error);
  return { ok: true };
}

async function canvas(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseCanvasRequest(await readJson<unknown>(req));
  const caller: Caller = { userId: requireUserId(ctx), userDb: ctx.supabase, adminDb: ctx.supabaseAdmin };
  switch (request.action) {
    case 'connect':
      return json(await connect(caller, request));
    case 'list_courses':
      return json(await listCourses(caller, request));
    case 'import':
      return json(await importCourses(caller, request));
    case 'sync':
      return json(await sync(caller, request));
    case 'fetch_syllabus':
      return json(await fetchSyllabus(caller, request));
    case 'disconnect':
      return json(await disconnect(caller, request));
  }
}

export default { fetch: withSupabase({ auth: 'user' }, handle(canvas)) };
