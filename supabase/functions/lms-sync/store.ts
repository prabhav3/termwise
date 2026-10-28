// Database access for lms-sync. Connections, secrets, and the feed's course labels (kept in
// lms_courses: external_id = label, linked_course_id = the mapped Termwise course) are written
// with the service role; students can read them and edit the mapping through RLS.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveTimeZone } from '../_shared/calendar-model.ts';
import { HttpError } from '../_shared/http.ts';
import { openSecret, sealSecret } from '../_shared/secrets.ts';

export type Db = SupabaseClient;
export type FeedProvider = 'moodle' | 'blackboard' | 'ics';

export interface FeedConnection {
  id: string;
  provider: FeedProvider;
  base_url: string;
  display_name: string | null;
}

export interface LabelRow {
  id: string;
  external_id: string;
  linked_course_id: string | null;
}

export interface CourseRow {
  id: string;
  code: string | null;
  title: string;
}

export interface ItemRow {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  due_date: string | null;
  due_time: string | null;
  is_major: boolean;
  points_possible: number | null;
  source: string;
}

export function dbFail(context: string, error: { code?: string } | null): never {
  console.error(`lms-sync: ${context} failed (${error?.code ?? 'unknown'})`);
  throw new HttpError('internal', 'Something went wrong saving your LMS data. Please try again.');
}

export async function saveConnection(
  adminDb: Db,
  userId: string,
  input: { provider: FeedProvider; baseUrl: string; displayName: string; feedUrl: string },
): Promise<string> {
  const { data, error } = await adminDb
    .from('lms_connections')
    .upsert(
      {
        user_id: userId,
        provider: input.provider,
        base_url: input.baseUrl,
        display_name: input.displayName,
        status: 'active',
        last_error: null,
      },
      { onConflict: 'user_id,provider,base_url' },
    )
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (error || !data) dbFail('connection save', error);
  const { error: secretError } = await adminDb.from('lms_secrets').upsert(
    {
      connection_id: data.id,
      user_id: userId,
      feed_url_enc: await sealSecret(input.feedUrl),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'connection_id' },
  );
  if (secretError) dbFail('feed save', secretError);
  return data.id;
}

/** The caller's feed connection (RLS proves ownership). */
export async function loadConnection(userDb: Db, connectionId: string): Promise<FeedConnection> {
  const { data, error } = await userDb
    .from('lms_connections')
    .select('id, provider, base_url, display_name')
    .eq('id', connectionId)
    .maybeSingle()
    .overrideTypes<{ id: string; provider: string; base_url: string; display_name: string | null }, { merge: false }>();
  if (error) dbFail('connection lookup', error);
  if (!data || !['moodle', 'blackboard', 'ics'].includes(data.provider)) throw new HttpError('not_found', 'LMS connection not found.');
  return { ...data, provider: data.provider as FeedProvider };
}

export async function setStatus(
  adminDb: Db,
  connectionId: string,
  status: 'active' | 'needs_reauth',
  lastError: string | null,
  syncedAt?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, last_error: lastError };
  if (syncedAt) patch.last_synced_at = syncedAt;
  const { error } = await adminDb.from('lms_connections').update(patch).eq('id', connectionId);
  if (error) console.error(`lms-sync: status update failed (${error.code})`);
}

export async function loadFeedUrl(adminDb: Db, connectionId: string): Promise<string> {
  const { data, error } = await adminDb
    .from('lms_secrets')
    .select('feed_url_enc')
    .eq('connection_id', connectionId)
    .maybeSingle()
    .overrideTypes<{ feed_url_enc: string | null }, { merge: false }>();
  if (error) dbFail('feed lookup', error);
  const feedUrl = await openSecret(data?.feed_url_enc);
  if (feedUrl) return feedUrl;
  await setStatus(adminDb, connectionId, 'needs_reauth', 'The saved calendar link could not be read.');
  throw new HttpError('upstream_auth', 'Reconnect your LMS calendar to keep checking it.');
}

export async function profileTimeZone(userDb: Db, userId: string): Promise<string> {
  const { data, error } = await userDb
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle()
    .overrideTypes<{ timezone: string }, { merge: false }>();
  if (error) dbFail('profile lookup', error);
  return resolveTimeZone(data?.timezone, 'America/New_York');
}

export async function loadCourses(userDb: Db): Promise<CourseRow[]> {
  const { data, error } = await userDb
    .from('courses')
    .select('id, code, title')
    .eq('archived', false)
    .overrideTypes<CourseRow[], { merge: false }>();
  if (error) dbFail('course lookup', error);
  return data ?? [];
}

/**
 * Every item of the courses, including source 'lms' ones ("Add to my plan" on a missing_in_syllabus
 * discrepancy): they must pair with their feed event, or the next sync offers them again.
 */
export async function loadItems(userDb: Db, courseIds: string[]): Promise<ItemRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await userDb
    .from('items')
    .select('id, course_id, title, kind, due_date, due_time, is_major, points_possible, source')
    .in('course_id', courseIds)
    .overrideTypes<ItemRow[], { merge: false }>();
  if (error) dbFail('item lookup', error);
  return data ?? [];
}

/** Records the feed's labels and returns every stored label row for the connection. */
export async function saveLabels(adminDb: Db, userId: string, connectionId: string, labels: string[]): Promise<LabelRow[]> {
  if (labels.length > 0) {
    const { error } = await adminDb.from('lms_courses').upsert(
      labels.map((label) => ({ user_id: userId, connection_id: connectionId, external_id: label, name: label })),
      { onConflict: 'connection_id,external_id', ignoreDuplicates: true },
    );
    if (error) dbFail('course label save', error);
  }
  const { data, error } = await adminDb
    .from('lms_courses')
    .select('id, external_id, linked_course_id')
    .eq('connection_id', connectionId)
    .overrideTypes<LabelRow[], { merge: false }>();
  if (error) dbFail('course label lookup', error);
  return data ?? [];
}

export async function linkLabel(adminDb: Db, rowId: string, courseId: string | null, syncedAt: string): Promise<void> {
  const { error } = await adminDb
    .from('lms_courses')
    .update({ linked_course_id: courseId, sync_enabled: courseId !== null, last_synced_at: syncedAt })
    .eq('id', rowId);
  if (error) dbFail('course label link', error);
}

/** Resolves open discrepancies of courses the feed no longer maps to. */
export async function resolveUnmapped(adminDb: Db, connectionId: string, mappedCourseIds: string[]): Promise<void> {
  let query = adminDb
    .from('lms_discrepancies')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .eq('status', 'open');
  if (mappedCourseIds.length > 0) query = query.not('course_id', 'in', `(${mappedCourseIds.join(',')})`);
  const { error } = await query;
  if (error) dbFail('discrepancy cleanup', error);
}
