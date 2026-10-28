// Typed wrappers for every Edge Function (contracts: supabase/functions/_shared/api.ts) plus
// the app-wide AppError. Every failure surfaces as an AppError whose message is safe to show.
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import type {
  AccountDeleteResponse,
  AccountRequest,
  ApiError,
  AppleTokenRequest,
  AppleTokenResponse,
  CalendarOAuthFinishRequest,
  CalendarOAuthFinishResponse,
  CalendarOAuthStartRequest,
  CalendarOAuthStartResponse,
  CalendarSyncRequest,
  CalendarSyncResponse,
  CanvasConnectResponse,
  CanvasFetchSyllabusResponse,
  CanvasImportResponse,
  CanvasListCoursesResponse,
  CanvasRequest,
  CanvasSyncResponse,
  LmsConnectResponse,
  LmsSyncRequest,
  LmsSyncResponse,
  OkResponse,
  ParseSyllabusRequest,
  ParseSyllabusResponse,
} from '@shared/api.ts';

import { SUPABASE_URL, supabase } from './supabase';

// ---- errors ---------------------------------------------------------------------

export type ApiErrorCode = ApiError['error']['code'];
export type AppErrorCode = ApiErrorCode | 'network' | 'database' | 'auth' | 'plan_failed' | 'unknown';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number | null;

  constructor(code: AppErrorCode, message: string, options?: { status?: number | null; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? null;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

const NETWORK_MESSAGE = "Couldn't reach Termwise. Check your connection and try again.";
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

function isApiErrorBody(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const inner = (value as { error: unknown }).error;
  return (
    typeof inner === 'object' &&
    inner !== null &&
    typeof (inner as { code?: unknown }).code === 'string' &&
    typeof (inner as { message?: unknown }).message === 'string'
  );
}

interface PostgrestLikeError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

function isPostgrestLike(error: unknown): error is PostgrestLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string' &&
    'details' in error
  );
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && /network|fetch/i.test(error.message);
}

/** Normalizes anything thrown by supabase-js (or fetch) into an AppError with a friendly message. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isNetworkFailure(error)) return new AppError('network', NETWORK_MESSAGE, { cause: error });
  if (isPostgrestLike(error)) {
    switch (error.code) {
      case 'PGRST116':
      case 'P0002':
        return new AppError('not_found', "We couldn't find that. It may have been deleted.", { cause: error });
      case '23505':
        return new AppError('conflict', 'That already exists.', { cause: error });
      case '42501':
      case '28000':
      case 'PGRST301':
        return new AppError('unauthorized', 'Your session has expired. Please sign in again.', { cause: error });
      case '23514':
        return new AppError('bad_request', 'One of those values is out of range.', { cause: error });
      default:
        return new AppError('database', "Couldn't save or load your data. Please try again.", { cause: error });
    }
  }
  return new AppError('unknown', GENERIC_MESSAGE, { cause: error });
}

/** User-facing message for any thrown value. */
export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

// ---- invoke -----------------------------------------------------------------------

type FunctionName =
  | 'parse-syllabus'
  | 'calendar-oauth-start'
  | 'calendar-oauth-finish'
  | 'calendar-sync'
  | 'canvas'
  | 'lms-sync'
  | 'account'
  | 'apple-token';

async function invoke<TResponse>(name: FunctionName, body: object): Promise<TResponse> {
  let result: Awaited<ReturnType<typeof supabase.functions.invoke<TResponse>>>;
  try {
    result = await supabase.functions.invoke<TResponse>(name, { body, method: 'POST' });
  } catch (error) {
    throw toAppError(error);
  }
  const { data, error } = result;
  if (!error) {
    if (data === null) throw new AppError('internal', GENERIC_MESSAGE);
    return data;
  }
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body (e.g. a gateway page): fall through to the generic message.
    }
    if (isApiErrorBody(parsed)) {
      throw new AppError(parsed.error.code, parsed.error.message, { status: response.status, cause: error });
    }
    throw new AppError(response.status === 401 ? 'unauthorized' : 'internal', GENERIC_MESSAGE, {
      status: response.status,
      cause: error,
    });
  }
  if (error instanceof FunctionsFetchError) throw new AppError('network', NETWORK_MESSAGE, { cause: error });
  if (error instanceof FunctionsRelayError) throw new AppError('upstream_error', GENERIC_MESSAGE, { cause: error });
  throw toAppError(error);
}

// ---- parse-syllabus -------------------------------------------------------------------

/** Starts the AI parse job (202). Watch the row with useUploadStatus(upload_id). */
export function parseSyllabus(request: ParseSyllabusRequest): Promise<ParseSyllabusResponse> {
  return invoke('parse-syllabus', request);
}

// ---- calendars -----------------------------------------------------------------------

export function calendarOAuthStart(request: CalendarOAuthStartRequest): Promise<CalendarOAuthStartResponse> {
  return invoke('calendar-oauth-start', request);
}

/** Attaches the calendar the callback authorized (`pending` from its redirect) to the signed-in account. */
export function calendarOAuthFinish(request: CalendarOAuthFinishRequest): Promise<CalendarOAuthFinishResponse> {
  return invoke('calendar-oauth-finish', request);
}

export function calendarSync(request: CalendarSyncRequest = {}): Promise<CalendarSyncResponse> {
  return invoke('calendar-sync', request);
}

// ---- canvas ---------------------------------------------------------------------------

type CanvasAction = CanvasRequest['action'];

interface CanvasResponses {
  connect: CanvasConnectResponse;
  list_courses: CanvasListCoursesResponse;
  import: CanvasImportResponse;
  sync: CanvasSyncResponse;
  fetch_syllabus: CanvasFetchSyllabusResponse;
  disconnect: OkResponse;
}

/** One entry point for every Canvas action; the response type follows `request.action`. */
export function canvas<A extends CanvasAction>(
  request: Extract<CanvasRequest, { action: A }>,
): Promise<CanvasResponses[A]> {
  return invoke<CanvasResponses[A]>('canvas', request);
}

export const canvasConnect = (base_url: string, access_token: string) =>
  canvas({ action: 'connect', base_url, access_token });
export const canvasListCourses = (connection_id: string) => canvas({ action: 'list_courses', connection_id });
export const canvasImport = (request: Omit<Extract<CanvasRequest, { action: 'import' }>, 'action'>) =>
  canvas({ action: 'import', ...request });
export const canvasSync = (connection_id: string) => canvas({ action: 'sync', connection_id });
export const canvasFetchSyllabus = (connection_id: string, external_id: string) =>
  canvas({ action: 'fetch_syllabus', connection_id, external_id });
export const canvasDisconnect = (connection_id: string) => canvas({ action: 'disconnect', connection_id });

// ---- other LMS (iCal feeds) ---------------------------------------------------------------

export function lmsConnect(request: Omit<Extract<LmsSyncRequest, { action: 'connect' }>, 'action'>): Promise<LmsConnectResponse> {
  return invoke('lms-sync', { action: 'connect', ...request });
}

export function lmsSync(request: Omit<Extract<LmsSyncRequest, { action: 'sync' }>, 'action'>): Promise<LmsSyncResponse> {
  return invoke('lms-sync', { action: 'sync', ...request });
}

// ---- account --------------------------------------------------------------------------------

/**
 * Permanently deletes the caller's files and account (App Store guideline 5.1.1(v)) and revokes
 * their Sign in with Apple token. Pass a fresh Apple authorizationCode when the account has no
 * stored Apple token (a previous answer of `apple_revocation: 'no_token'`).
 */
export function deleteAccount(options: { appleAuthorizationCode?: string } = {}): Promise<AccountDeleteResponse> {
  const request: AccountRequest = options.appleAuthorizationCode
    ? { action: 'delete', apple_authorization_code: options.appleAuthorizationCode }
    : { action: 'delete' };
  return invoke('account', request);
}

/** Hands the Sign in with Apple authorizationCode to the server, so account deletion can revoke it. */
export function storeAppleToken(request: AppleTokenRequest): Promise<AppleTokenResponse> {
  return invoke('apple-token', request);
}

// ---- public links ------------------------------------------------------------------------------

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

/** https feed URL for Google Calendar / Outlook "subscribe from URL". */
export function icsFeedUrl(icsToken: string): string {
  return `${FUNCTIONS_BASE}/ics-feed?token=${encodeURIComponent(icsToken)}`;
}

/** webcal:// variant that opens Apple Calendar's subscribe sheet directly. */
export function icsSubscribeUrl(icsToken: string): string {
  return icsFeedUrl(icsToken).replace(/^https?:\/\//, 'webcal://');
}

/** Web preview page for a share link (works for people without the app). */
export function sharePreviewUrl(slug: string): string {
  return `${FUNCTIONS_BASE}/share-preview?slug=${encodeURIComponent(slug)}`;
}

/** Deep link that opens the import screen in the app. */
export function shareAppUrl(slug: string): string {
  return `termwise://share/${encodeURIComponent(slug)}`;
}
