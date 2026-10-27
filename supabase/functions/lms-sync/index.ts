// lms-sync (auth: user) — private iCal feeds from Blackboard, Moodle, Brightspace, or any LMS.
// POST LmsSyncRequest (supabase/functions/_shared/api.ts):
//   connect  validate and parse the feed, store its URL encrypted, return the feed's course labels
//   sync     map feed courses to Termwise courses (course_map, an earlier mapping, or code/title
//            similarity), match events to items, and record discrepancies
// Feeds carry dates only, so this compares dates and presence — never weights or lock times.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { LmsConnectResponse, LmsSyncRequest, LmsSyncResponse } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { countOpenDiscrepancies, saveDiscrepancies } from '../_shared/discrepancy-store.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { buildItemDiscrepancies, type LmsSide, matchCandidates, matchFeedCourses, type SyllabusSide } from '../_shared/match.ts';
import { assertPublicHttpsUrl, SafeFetchError } from '../_shared/safe-fetch.ts';
import { type FeedEvent, FeedError, feedEvents, feedLabels, fetchFeed, normalizeFeedUrl } from './feed.ts';
import {
  type Db,
  type FeedProvider,
  type ItemRow,
  linkLabel,
  loadConnection,
  loadCourses,
  loadFeedUrl,
  loadItems,
  profileTimeZone,
  resolveUnmapped,
  saveConnection,
  saveLabels,
  setStatus,
} from './store.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_NAMES: Record<FeedProvider, string> = { moodle: 'Moodle', blackboard: 'Blackboard', ics: 'Your LMS' };

interface Caller {
  userId: string;
  userDb: Db;
  adminDb: Db;
}

function parseRequest(raw: unknown): LmsSyncRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError('bad_request', 'Request body must be an object.');
  const body = raw as Record<string, unknown>;
  if (body.action === 'connect') {
    if (body.provider !== 'moodle' && body.provider !== 'blackboard' && body.provider !== 'ics') {
      throw new HttpError('bad_request', 'provider must be moodle, blackboard, or ics.');
    }
    if (typeof body.feed_url !== 'string' || !body.feed_url.trim() || body.feed_url.length > 2048) {
      throw new HttpError('bad_request', 'Paste the calendar (iCal) link from your LMS.');
    }
    if (body.display_name !== undefined && (typeof body.display_name !== 'string' || body.display_name.length > 80)) {
      throw new HttpError('bad_request', 'display_name must be text of at most 80 characters.');
    }
    return {
      action: 'connect',
      provider: body.provider,
      feed_url: body.feed_url,
      display_name: typeof body.display_name === 'string' ? body.display_name.trim() || undefined : undefined,
    };
  }
  if (body.action === 'sync') {
    if (typeof body.connection_id !== 'string' || !UUID_RE.test(body.connection_id)) throw new HttpError('bad_request', 'connection_id is required.');
    let courseMap: Record<string, string> | undefined;
    if (body.course_map !== undefined && body.course_map !== null) {
      if (typeof body.course_map !== 'object' || Array.isArray(body.course_map)) throw new HttpError('bad_request', 'course_map must be an object.');
      courseMap = {};
      for (const [label, courseId] of Object.entries(body.course_map as Record<string, unknown>)) {
        if (typeof courseId !== 'string' || !UUID_RE.test(courseId)) throw new HttpError('bad_request', 'course_map values must be course ids.');
        courseMap[label] = courseId;
      }
    }
    return { action: 'sync', connection_id: body.connection_id, course_map: courseMap };
  }
  throw new HttpError('bad_request', 'Unknown action.');
}

/** Feed failures → ApiErrors; a revoked link also marks the connection for reconnecting. */
async function readFeed(caller: Caller, feedUrl: string, connectionId: string | null) {
  try {
    return await fetchFeed(feedUrl);
  } catch (err) {
    if (!(err instanceof FeedError)) throw err;
    if (!connectionId) throw new HttpError('bad_request', err.message);
    if (err.failure === 'revoked') {
      await setStatus(caller.adminDb, connectionId, 'needs_reauth', err.message);
      throw new HttpError('upstream_auth', err.message);
    }
    await setStatus(caller.adminDb, connectionId, 'active', err.message);
    throw new HttpError('upstream_error', err.message);
  }
}

async function connect(caller: Caller, request: Extract<LmsSyncRequest, { action: 'connect' }>): Promise<LmsConnectResponse> {
  const feedUrl = normalizeFeedUrl(request.feed_url);
  let origin: string;
  try {
    origin = assertPublicHttpsUrl(feedUrl).origin.toLowerCase();
  } catch (err) {
    if (err instanceof SafeFetchError) throw new HttpError('bad_request', err.message);
    throw err;
  }
  const feed = await readFeed(caller, feedUrl, null);
  const timeZone = await profileTimeZone(caller.userDb, caller.userId);
  const labels = feedLabels(feedEvents(feed, timeZone));

  const displayName = request.display_name ?? (feed.name?.trim().slice(0, 80) || new URL(origin).hostname);
  const connectionId = await saveConnection(caller.adminDb, caller.userId, {
    provider: request.provider,
    baseUrl: origin,
    displayName,
    feedUrl,
  });
  const rows = await saveLabels(caller.adminDb, caller.userId, connectionId, labels);

  // Pre-fill the obvious mappings so the first sync can start without questions.
  const suggested = matchFeedCourses(labels, await loadCourses(caller.userDb));
  const now = new Date().toISOString();
  await Promise.all(
    rows
      .filter((row) => !row.linked_course_id && suggested.has(row.external_id))
      .map((row) => linkLabel(caller.adminDb, row.id, suggested.get(row.external_id) ?? null, now)),
  );
  return { connection_id: connectionId, feed_courses: labels };
}

function syllabusSide(item: ItemRow): SyllabusSide {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    due_date: item.due_date,
    due_time: item.due_time ? item.due_time.slice(0, 5) : null,
    is_major: item.is_major,
    points_possible: item.points_possible,
  };
}

function lmsSide(event: FeedEvent): LmsSide {
  return {
    external_id: event.externalId,
    title: event.title,
    due_date: event.date,
    due_time: event.time,
    lock_date: null,
    lock_time: null,
    points_possible: null,
  };
}

async function sync(caller: Caller, request: Extract<LmsSyncRequest, { action: 'sync' }>): Promise<LmsSyncResponse> {
  const connection = await loadConnection(caller.userDb, request.connection_id);
  const feedUrl = await loadFeedUrl(caller.adminDb, connection.id);
  const feed = await readFeed(caller, feedUrl, connection.id);
  const timeZone = await profileTimeZone(caller.userDb, caller.userId);
  const events = feedEvents(feed, timeZone);
  const labels = feedLabels(events);

  const courses = await loadCourses(caller.userDb);
  const courseIds = new Set(courses.map((c) => c.id));
  for (const courseId of Object.values(request.course_map ?? {})) {
    if (!courseIds.has(courseId)) throw new HttpError('bad_request', 'One of the mapped courses no longer exists.');
  }

  // Mapping precedence: this request's course_map, then the stored mapping, then a confident guess.
  const rows = await saveLabels(caller.adminDb, caller.userId, connection.id, labels);
  const stored = new Map(rows.map((row) => [row.external_id, row]));
  const guessed = matchFeedCourses(
    labels.filter((label) => !request.course_map?.[label] && !stored.get(label)?.linked_course_id),
    courses.filter((c) => ![...stored.values()].some((row) => row.linked_course_id === c.id)),
  );
  const mapping = new Map<string, string>();
  const now = new Date().toISOString();
  const linkWrites: Array<Promise<void>> = [];
  for (const label of labels) {
    const row = stored.get(label);
    const previous = row?.linked_course_id && courseIds.has(row.linked_course_id) ? row.linked_course_id : null;
    const courseId = request.course_map?.[label] ?? previous ?? guessed.get(label) ?? null;
    if (courseId) mapping.set(label, courseId);
    if (row) linkWrites.push(linkLabel(caller.adminDb, row.id, courseId, now));
  }
  await Promise.all(linkWrites);

  const eventsByCourse = new Map<string, FeedEvent[]>();
  for (const event of events) {
    const courseId = mapping.get(event.label);
    if (courseId) eventsByCourse.set(courseId, [...(eventsByCourse.get(courseId) ?? []), event]);
  }
  const items = await loadItems(caller.userDb, [...eventsByCourse.keys()]);
  const lmsName = connection.provider === 'ics' ? connection.display_name || PROVIDER_NAMES.ics : PROVIDER_NAMES[connection.provider];

  let matched = 0;
  for (const [courseId, courseEvents] of eventsByCourse) {
    const courseItems = items.filter((item) => item.course_id === courseId);
    const result = matchCandidates(
      courseItems.map((item) => ({ id: item.id, title: item.title, kind: item.kind, date: item.due_date, item })),
      courseEvents.map((event) => ({ id: event.externalId, title: event.title, kind: event.kind, date: event.date, event })),
    );
    matched += result.pairs.length;
    const dates = courseEvents.map((e) => e.date).sort();
    const prefix = `lms:${connection.id}:${courseId}`;
    // A course without items has nothing to compare with yet.
    const records =
      courseItems.length === 0
        ? []
        : buildItemDiscrepancies({
            scope: prefix,
            lmsName,
            pairs: result.pairs.map((p) => ({ syllabus: syllabusSide(p.a.item), lms: lmsSide(p.b.event) })),
            unmatchedSyllabus: result.unmatchedA.map((c) => syllabusSide(c.item)),
            unmatchedLms: result.unmatchedB.map((c) => lmsSide(c.event)),
            window: { from: dates[0], to: dates[dates.length - 1] },
          });
    await saveDiscrepancies(caller.adminDb, { userId: caller.userId, connectionId: connection.id, courseId, prefix }, records);
  }
  await resolveUnmapped(caller.adminDb, connection.id, [...eventsByCourse.keys()]);
  await setStatus(caller.adminDb, connection.id, 'active', null, now);

  return {
    events: events.length,
    matched,
    discrepancies_open: await countOpenDiscrepancies(caller.userDb, connection.id),
    unmapped_feed_courses: labels.filter((label) => !mapping.has(label)),
  };
}

async function lmsSync(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const caller: Caller = { userId: requireUserId(ctx), userDb: ctx.supabase, adminDb: ctx.supabaseAdmin };
  return json(request.action === 'connect' ? await connect(caller, request) : await sync(caller, request));
}

export default { fetch: withSupabase({ auth: 'user' }, handle(lmsSync)) };
