// Request/response contracts for every Edge Function, shared by the functions (Deno) and the
// app's typed wrappers in src/lib/functions.ts (Metro). Types only — no runtime code, no imports.
//
// Every function answers errors as HTTP 4xx/5xx with body ApiError.

export interface ApiError {
  error: {
    code:
      | 'unauthorized'
      | 'bad_request'
      | 'not_found'
      | 'conflict'
      | 'upstream_auth'      // the LMS/calendar provider rejected our token (reconnect needed)
      | 'upstream_error'     // the LMS/calendar provider failed
      | 'rate_limited'
      | 'too_large'
      | 'unsupported_file'
      | 'ai_refused'
      | 'internal';
    message: string;         // safe to show to the student
  };
}

// ---------------------------------------------------------------------------
// parse-syllabus  (auth: user)
// POST { upload_id } -> 202. Work continues in the background; the app watches the
// syllabus_uploads row (Realtime + polling fallback) until status is needs_review or failed.
// ---------------------------------------------------------------------------
export interface ParseSyllabusRequest {
  upload_id: string;
}
export interface ParseSyllabusResponse {
  upload_id: string;
  status: 'processing';
}

// ---------------------------------------------------------------------------
// calendar-oauth-start  (auth: user)
// calendar-oauth-callback  (auth: none, verify_jwt = false; provider redirects here)
// calendar-oauth-finish  (auth: user)
// The app opens auth_url with WebBrowser.openAuthSessionAsync(auth_url, return_url). Start keeps
// a one-time pending row (state nonce + PKCE verifier) for the caller. After consent, the callback
// claims that row, exchanges the code, parks the encrypted tokens on it, and 302-redirects to
// `${return_url}?status=authorized&provider=google&pending=<one-time code>` or
// `${return_url}?status=error&provider=google&message=...`. The app then calls
// calendar-oauth-finish with `pending`; only the account that started the flow can finish it,
// and that call creates the calendar_connections row.
// ---------------------------------------------------------------------------
export type CloudCalendarProvider = 'google' | 'microsoft';
export interface CalendarOAuthStartRequest {
  provider: CloudCalendarProvider;
  /** Deep link back into the app, e.g. "termwise://integrations/calendar". Must use the app scheme. */
  return_url: string;
}
export interface CalendarOAuthStartResponse {
  auth_url: string;
}
export interface CalendarOAuthFinishRequest {
  /** The `pending` query parameter of the callback's redirect. */
  pending: string;
}
export interface CalendarOAuthFinishResponse {
  connection_id: string;
  provider: CloudCalendarProvider;
}

// ---------------------------------------------------------------------------
// calendar-sync  (auth: user)
// Two-way sync for Google / Microsoft connections. Pushes every dated item of active terms
// (and plan blocks when the connection has sync_plan_blocks) into the dedicated "Termwise"
// calendar or task list; pulls edits the student made there back as items.external_change.
// ---------------------------------------------------------------------------
export interface CalendarSyncRequest {
  /** Omit to sync every active cloud connection of the caller. */
  connection_id?: string;
}
export interface CalendarSyncResult {
  connection_id: string;
  provider: CloudCalendarProvider;
  created: number;
  updated: number;
  deleted: number;
  /** Items whose date the student changed in the external calendar (awaiting review in-app). */
  external_changes: number;
  errors: string[];
}
export interface CalendarSyncResponse {
  results: CalendarSyncResult[];
}

// ---------------------------------------------------------------------------
// ics-feed  (auth: none, verify_jwt = false)
// GET /functions/v1/ics-feed?token=<profiles.ics_token>  ->  text/calendar
// Subscribe from Apple Calendar, Outlook, or Google Calendar ("From URL"). Read-only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// canvas  (auth: user) — Canvas LMS as a first-class source
// ---------------------------------------------------------------------------
export interface CanvasCourseSummary {
  external_id: string;
  name: string;
  course_code: string | null;
  term_name: string | null;
  start_at: string | null;
  end_at: string | null;
  has_syllabus: boolean;
  linked_course_id: string | null;
}

export type CanvasRequest =
  | {
      action: 'connect';
      /** e.g. "https://school.instructure.com" (scheme optional; normalized server-side) */
      base_url: string;
      /** Canvas personal access token (Account > Settings > New Access Token). */
      access_token: string;
    }
  | { action: 'list_courses'; connection_id: string }
  | {
      action: 'import';
      connection_id: string;
      courses: Array<{
        external_id: string;
        /** Merge into an existing Termwise course (e.g. one created from an uploaded syllabus). */
        link_course_id?: string | null;
        term_id?: string | null;
      }>;
      /** Also import the student's Canvas scores into the grade tracker. Default true. */
      include_scores?: boolean;
    }
  | { action: 'sync'; connection_id: string }
  | {
      /** Copy the Canvas syllabus page into a syllabus_uploads row (source 'canvas') for AI parsing. */
      action: 'fetch_syllabus';
      connection_id: string;
      external_id: string;
    }
  | { action: 'disconnect'; connection_id: string };

export interface CanvasConnectResponse {
  connection_id: string;
  display_name: string | null;
  courses: CanvasCourseSummary[];
}
export interface CanvasListCoursesResponse {
  courses: CanvasCourseSummary[];
}
export interface CanvasImportResponse {
  imported: Array<{
    external_id: string;
    course_id: string;
    components_created: number;
    items_created: number;
    items_updated: number;
  }>;
  discrepancies_open: number;
}
export interface CanvasSyncResponse {
  synced_courses: number;
  items_created: number;
  items_updated: number;
  discrepancies_open: number;
}
export interface CanvasFetchSyllabusResponse {
  /** null when the Canvas course has no syllabus page content. */
  upload_id: string | null;
}
export interface OkResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// lms-sync  (auth: user) — generic iCal feeds (Blackboard, Moodle, Brightspace, any LMS)
// Discrepancy checks only (feeds carry dates, not weights or lock times).
// ---------------------------------------------------------------------------
export type LmsSyncRequest =
  | {
      action: 'connect';
      provider: 'moodle' | 'blackboard' | 'ics';
      feed_url: string;
      display_name?: string;
    }
  | {
      action: 'sync';
      connection_id: string;
      /** Feed course label -> Termwise course id, when the feed can't be matched automatically. */
      course_map?: Record<string, string>;
    };
export interface LmsConnectResponse {
  connection_id: string;
  /** Distinct course labels found in the feed, for mapping. */
  feed_courses: string[];
}
export interface LmsSyncResponse {
  events: number;
  matched: number;
  discrepancies_open: number;
  unmapped_feed_courses: string[];
}

// ---------------------------------------------------------------------------
// share-preview  (auth: none, verify_jwt = false)
// GET /functions/v1/share-preview?slug=<slug> -> HTML preview with an "Open in Termwise"
// button (termwise://share/<slug>). The app imports via rpc('import_shared_timeline').
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// account  (auth: user)
// POST { action: 'delete' } -> deletes the caller's storage files, revokes their Sign in with
// Apple tokens (Apple's /auth/revoke), then deletes the auth user (cascades). Required by App
// Store guideline 5.1.1(v). Deletion never fails because of Apple: the outcome is reported in
// `apple_revocation` instead.
// ---------------------------------------------------------------------------
export interface AccountRequest {
  action: 'delete';
  /**
   * A fresh Sign in with Apple authorizationCode, for accounts with no stored Apple token (the
   * app re-authorizes with Apple when a previous delete answered `apple_revocation: 'no_token'`).
   */
  apple_authorization_code?: string;
}
export type AppleRevocationOutcome =
  /** Apple's refresh token was revoked. */
  | 'revoked'
  /** The account never used Sign in with Apple. */
  | 'not_linked'
  /** The server has no Apple key configured (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY). */
  | 'skipped'
  /** Apple sign-in account, but no stored token and no authorization code was sent. */
  | 'no_token'
  /** Apple rejected the request or could not be reached. */
  | 'failed';
export interface AccountDeleteResponse extends OkResponse {
  apple_revocation: AppleRevocationOutcome;
}

// ---------------------------------------------------------------------------
// apple-token  (auth: user)
// POST { authorization_code } right after Sign in with Apple. Exchanges the code at Apple's
// /auth/token and keeps the refresh token (encrypted, service role only) so account deletion
// can revoke it. `stored: false` when the server has no Apple key configured or Apple returned
// no refresh token; sign-in never depends on this call.
// ---------------------------------------------------------------------------
export interface AppleTokenRequest {
  authorization_code: string;
}
export interface AppleTokenResponse {
  stored: boolean;
}
