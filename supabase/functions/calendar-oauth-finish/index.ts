// calendar-oauth-finish (auth: user) — POST { pending } -> { connection_id, provider }.
// The last step of the Google / Microsoft connect flow: the app calls it with the one-time code
// calendar-oauth-callback put on its return_url. The pending row is consumed (deleted) whatever
// happens, and becomes the caller's calendar_connections + calendar_secrets rows only when the
// caller is the account that started the flow — a consent link forwarded to someone else can't
// attach their Google / Outlook account to the sender's Termwise account.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CalendarOAuthFinishRequest, CalendarOAuthFinishResponse, CloudCalendarProvider } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { hashFinishCode, isFinishCode, pendingFinishFailure } from '../_shared/oauth-state.ts';
import { type PendingTokens, storeConnection } from './store.ts';

const CONNECT_AGAIN = 'This calendar sign-in expired or was already used. Please connect again.';

function parseRequest(raw: unknown): CalendarOAuthFinishRequest {
  if (typeof raw !== 'object' || raw === null) throw new HttpError('bad_request', 'Request body must be an object.');
  const pending = (raw as Partial<Record<keyof CalendarOAuthFinishRequest, unknown>>).pending;
  if (!isFinishCode(pending)) throw new HttpError('bad_request', 'pending must be the code from the sign-in redirect.');
  return { pending };
}

async function finish(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const userId = requireUserId(ctx);

  // Delete-and-return in one statement: each code works at most once.
  const { data: row, error } = await ctx.supabaseAdmin
    .from('calendar_oauth_pending')
    .delete()
    .eq('finish_code_hash', await hashFinishCode(request.pending))
    .select('user_id, provider, expires_at, account_email, access_token_enc, refresh_token_enc, access_token_expires_at, scope')
    .maybeSingle()
    .overrideTypes<PendingTokens & { user_id: string; provider: CloudCalendarProvider; expires_at: string }, { merge: false }>();
  if (error) {
    console.error(`calendar-oauth-finish: pending lookup failed (${error.code})`);
    throw new HttpError('internal', "We couldn't finish connecting your calendar. Please try again.");
  }

  const failure = pendingFinishFailure(row, userId);
  if (failure === 'wrong_account') {
    throw new HttpError(
      'bad_request',
      'This calendar sign-in was started from a different Termwise account, so it was cancelled. Connect your calendar again from this app.',
      403,
    );
  }
  if (failure || !row) throw new HttpError('not_found', CONNECT_AGAIN);

  const connectionId = await storeConnection(ctx.supabaseAdmin, userId, row.provider, row);
  const response: CalendarOAuthFinishResponse = { connection_id: connectionId, provider: row.provider };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(finish)) };
