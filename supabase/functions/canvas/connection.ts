// Canvas connection plumbing: token sealing, connection lookup, error mapping, lms_courses.
import type { CanvasCourseSummary } from '../_shared/api.ts';
import { CanvasClient, type CanvasCourse, CanvasError, hasSyllabusContent } from '../_shared/canvas-client.ts';
import { decryptSecret, encryptSecret, importTokenKey, SecretFormatError } from '../_shared/crypto.ts';
import { HttpError, requireEnv } from '../_shared/http.ts';
import { safeFetch, SafeFetchError } from '../_shared/safe-fetch.ts';
import { CONNECTION_COLUMNS, type ConnectionRow, type Db, dbFail, LMS_COURSE_COLUMNS, type LmsCourseRow } from './rows.ts';

async function tokenKey(): Promise<CryptoKey> {
  try {
    return await importTokenKey(requireEnv('TOKEN_ENCRYPTION_KEY'));
  } catch (err) {
    if (err instanceof SecretFormatError) throw new HttpError('internal', 'Server is misconfigured (TOKEN_ENCRYPTION_KEY).');
    throw err;
  }
}

export async function sealToken(token: string): Promise<string> {
  return encryptSecret(token, await tokenKey());
}

export function newCanvasClient(baseUrl: string, token: string): CanvasClient {
  return new CanvasClient(baseUrl, token, { fetcher: safeFetch });
}

/** The caller's Canvas connection (RLS proves ownership). */
export async function loadConnection(userDb: Db, connectionId: unknown): Promise<ConnectionRow> {
  if (typeof connectionId !== 'string' || !connectionId) throw new HttpError('bad_request', 'connection_id is required.');
  const { data, error } = await userDb
    .from('lms_connections')
    .select(CONNECTION_COLUMNS)
    .eq('id', connectionId)
    .maybeSingle()
    .overrideTypes<ConnectionRow, { merge: false }>();
  if (error) {
    if (error.code === '22P02') throw new HttpError('not_found', 'Canvas connection not found.');
    dbFail('connection lookup', error);
  }
  if (!data || data.provider !== 'canvas') throw new HttpError('not_found', 'Canvas connection not found.');
  return data;
}

/** A client for a stored connection, with its token decrypted (service role only). */
export async function clientForConnection(adminDb: Db, connection: ConnectionRow): Promise<CanvasClient> {
  const { data, error } = await adminDb
    .from('lms_secrets')
    .select('token_enc')
    .eq('connection_id', connection.id)
    .maybeSingle()
    .overrideTypes<{ token_enc: string | null }, { merge: false }>();
  if (error) dbFail('secret lookup', error);
  if (!data?.token_enc) {
    await setStatus(adminDb, connection.id, 'needs_reauth', 'Missing access token.');
    throw new HttpError('upstream_auth', 'Reconnect Canvas to keep syncing.');
  }
  let token: string;
  try {
    token = await decryptSecret(data.token_enc, await tokenKey());
  } catch (err) {
    if (!(err instanceof SecretFormatError)) throw err;
    await setStatus(adminDb, connection.id, 'needs_reauth', 'Stored token could not be read.');
    throw new HttpError('upstream_auth', 'Reconnect Canvas to keep syncing.');
  }
  return newCanvasClient(connection.base_url, token);
}

export async function setStatus(
  adminDb: Db,
  connectionId: string,
  status: ConnectionRow['status'],
  lastError: string | null,
  syncedAt?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, last_error: lastError };
  if (syncedAt) patch.last_synced_at = syncedAt;
  const { error } = await adminDb.from('lms_connections').update(patch).eq('id', connectionId);
  if (error) console.error(`canvas: status update failed (${error.code})`);
}

/** Maps Canvas / network failures to ApiError codes; marks the connection when the token died. */
export async function toHttpError(err: unknown, adminDb: Db, connectionId: string | null): Promise<unknown> {
  if (err instanceof CanvasError) {
    switch (err.kind) {
      case 'auth':
        if (connectionId) await setStatus(adminDb, connectionId, 'needs_reauth', 'Canvas rejected the access token.');
        return new HttpError(
          'upstream_auth',
          'Canvas no longer accepts this access token. Create a new one in Canvas (Account → Settings) and reconnect.',
        );
      case 'rate_limited':
        return new HttpError('rate_limited', err.message);
      case 'not_found':
        return new HttpError('not_found', 'Canvas could not find that course. It may have ended or been unpublished.');
      case 'forbidden':
        return new HttpError('upstream_error', 'Canvas did not allow access to that course.');
      default:
        if (connectionId) await setStatus(adminDb, connectionId, 'active', err.message);
        return new HttpError('upstream_error', 'Canvas is having trouble right now. Try again in a few minutes.');
    }
  }
  if (err instanceof SafeFetchError) {
    switch (err.code) {
      case 'unsafe_url':
        return new HttpError('bad_request', err.message);
      case 'too_large':
        return new HttpError('too_large', 'Canvas sent more data than Termwise can handle for one course.');
      case 'timeout':
        return new HttpError('upstream_error', 'Canvas took too long to answer. Try again in a minute.');
      default:
        return new HttpError('upstream_error', "We couldn't reach Canvas. Check the address and try again.");
    }
  }
  return err;
}

export function courseSummary(row: LmsCourseRow): CanvasCourseSummary {
  return {
    external_id: row.external_id,
    name: row.name,
    course_code: row.course_code,
    term_name: row.term_name,
    start_at: row.start_at,
    end_at: row.end_at,
    has_syllabus: row.has_syllabus,
    linked_course_id: row.linked_course_id,
  };
}

function lmsCourseFields(course: CanvasCourse) {
  return {
    external_id: String(course.id),
    name: (course.name ?? 'Canvas course').trim().slice(0, 200) || 'Canvas course',
    course_code: course.course_code?.trim() || null,
    term_name: course.term?.name?.trim() || null,
    start_at: course.start_at ?? course.term?.start_at ?? null,
    end_at: course.end_at ?? course.term?.end_at ?? null,
    has_syllabus: hasSyllabusContent(course.syllabus_body),
  };
}

/**
 * Upserts Canvas courses into lms_courses (service role: students can't insert there) without
 * touching linked_course_id / sync_enabled, and returns the stored rows.
 */
export async function upsertLmsCourses(adminDb: Db, userId: string, connectionId: string, courses: CanvasCourse[]): Promise<LmsCourseRow[]> {
  if (courses.length === 0) return [];
  const rows = courses.map((c) => ({ user_id: userId, connection_id: connectionId, ...lmsCourseFields(c) }));
  const { data, error } = await adminDb
    .from('lms_courses')
    .upsert(rows, { onConflict: 'connection_id,external_id' })
    .select(LMS_COURSE_COLUMNS)
    .overrideTypes<LmsCourseRow[], { merge: false }>();
  if (error) dbFail('course list save', error);
  const order = new Map(rows.map((r, i) => [r.external_id, i]));
  return (data ?? []).sort((a, b) => (order.get(a.external_id) ?? 0) - (order.get(b.external_id) ?? 0));
}
