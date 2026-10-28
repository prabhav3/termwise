// calendar-sync (auth: user) — POST { connection_id? } -> { results: CalendarSyncResult[] }.
// Two-way sync of Google Calendar / Google Tasks and Outlook Calendar / Microsoft To Do.
//
// Push: the desired set is every dated item of a non-archived course (+ planned study blocks for
// the next 30 days when the connection has sync_plan_blocks), keyed 'item:<id>' / 'block:<key>'.
// delivery 'all_day_event' → all-day events (a 30-minute event ending at due_time when the item
// has one); delivery 'task' → tasks. Everything lives in a dedicated "Termwise" calendar / task
// list that is created on first use. calendar_event_links stores, per key, the external id, the
// hash of the payload we pushed, and the date we pushed: new keys are created, keys whose hash
// changed are updated, keys no longer desired are deleted.
//
// Pull: for a link NOT pushed in this run whose pushed_hash equals the current desired hash, an
// external date different from pushed_date is written to items.external_change =
// { provider, new_due_date, new_due_time, detected_at }; an external deletion writes
// { ..., deleted: true } and keeps the link as a tombstone (deleted_externally = true). A tombstoned
// item is not pushed again while it is done or that deletion is pending.
//
// Contract with the app:
//   * Accepting a change: the app sets the item's due_date / due_time to the new values and clears
//     external_change. The item's hash then changes, so the next sync pushes it (same date).
//     Accepting a deletion marks the item done; the tombstone keeps it off the calendar.
//   * Rejecting a change: the app clears external_change and sets that link's pushed_hash to null.
//     The hash no longer matches, so the next sync pushes our date back over the external edit
//     (or, for a tombstone, drops it and recreates the entry).
//
// The provider's incremental cursor (Google syncToken), last_synced_at and last_error are stored
// on the connection. Provider failures are returned in errors[], never dropped.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CalendarSyncRequest, CalendarSyncResponse, CalendarSyncResult } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { loadStudentCalendar, type StudentCalendar } from './desired.ts';
import { CONNECTION_COLUMNS, type ConnectionRow, syncConnection } from './run.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECONNECT: Record<ConnectionRow['provider'], string> = {
  google: 'Google access was revoked or expired. Reconnect Google in Termwise to keep syncing.',
  microsoft: 'Outlook access was revoked or expired. Reconnect Outlook in Termwise to keep syncing.',
};

function parseRequest(raw: unknown): CalendarSyncRequest {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError('bad_request', 'Request body must be an object.');
  const id = (raw as { connection_id?: unknown }).connection_id;
  if (id === undefined || id === null) return {};
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError('bad_request', 'connection_id must be an id.');
  return { connection_id: id };
}

function idle(connection: ConnectionRow, message: string): CalendarSyncResult {
  return { connection_id: connection.id, provider: connection.provider, created: 0, updated: 0, deleted: 0, external_changes: 0, errors: [message] };
}

async function calendarSync(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const text = await req.text();
  let raw: unknown = null;
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError('bad_request', 'Request body must be JSON.');
    }
  }
  const request = parseRequest(raw);
  const userId = requireUserId(ctx);

  let query = ctx.supabase.from('calendar_connections').select(CONNECTION_COLUMNS).in('provider', ['google', 'microsoft']).eq('device_id', '');
  query = request.connection_id ? query.eq('id', request.connection_id) : query.eq('status', 'active');
  const { data, error } = await query.order('created_at').overrideTypes<ConnectionRow[], { merge: false }>();
  if (error) {
    console.error(`calendar-sync: connection lookup failed (${error.code})`);
    throw new HttpError('internal', "We couldn't load your calendar connections. Please try again.");
  }
  const connections = data ?? [];
  if (request.connection_id && connections.length === 0) throw new HttpError('not_found', 'Calendar connection not found.');

  const runnable = connections.filter((c) => c.status === 'active');
  const results: CalendarSyncResult[] = [];
  if (runnable.length > 0) {
    let calendar: StudentCalendar;
    try {
      calendar = await loadStudentCalendar(ctx.supabase, userId, runnable.some((c) => c.sync_plan_blocks));
    } catch (err) {
      console.error(err instanceof Error ? err.message : 'calendar-sync: load failed');
      throw new HttpError('internal', "We couldn't load your deadlines. Please try again.");
    }
    // One connection at a time: each provider throttles per account anyway.
    for (const connection of runnable) results.push(await syncConnection({ userDb: ctx.supabase, adminDb: ctx.supabaseAdmin, userId }, connection, calendar));
  }
  for (const connection of connections) {
    if (connection.status === 'needs_reauth') results.push(idle(connection, RECONNECT[connection.provider]));
    else if (connection.status === 'disconnected') results.push(idle(connection, 'This calendar is disconnected.'));
  }
  const response: CalendarSyncResponse = { results };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(calendarSync)) };
