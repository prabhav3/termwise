// calendar-oauth-start (auth: user) — POST { provider, return_url } -> { auth_url }.
// Builds the Google / Microsoft consent URL with a signed, 10-minute state carrying the caller's
// id and the app deep link, plus a PKCE (S256) challenge. A one-time pending row (state nonce,
// caller, provider, PKCE verifier) is stored with the service role; calendar-oauth-callback only
// accepts a state that matches an unused pending row. The app opens auth_url with
// WebBrowser.openAuthSessionAsync(auth_url, return_url) and finishes with calendar-oauth-finish.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CalendarOAuthStartRequest, CalendarOAuthStartResponse } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { googleAuthUrl } from '../_shared/google.ts';
import { handle, HttpError, json, readJson, requireEnv } from '../_shared/http.ts';
import { microsoftAuthUrl } from '../_shared/microsoft.ts';
import { createPkcePair, isAllowedReturnUrl, issueOAuthState, oauthRedirectUri, type ReturnUrlPolicy, withCodeChallenge } from '../_shared/oauth-state.ts';

/** exp:// return URLs (Expo Go) are a development convenience: only with ALLOW_EXPO_GO_RETURN=1. */
const RETURN_URL_POLICY: ReturnUrlPolicy = { allowExpoGo: Deno.env.get('ALLOW_EXPO_GO_RETURN') === '1' };

function parseRequest(raw: unknown): CalendarOAuthStartRequest {
  if (typeof raw !== 'object' || raw === null) throw new HttpError('bad_request', 'Request body must be an object.');
  const body = raw as Partial<Record<keyof CalendarOAuthStartRequest, unknown>>;
  if (body.provider !== 'google' && body.provider !== 'microsoft') throw new HttpError('bad_request', 'provider must be google or microsoft.');
  if (!isAllowedReturnUrl(body.return_url, RETURN_URL_POLICY)) {
    throw new HttpError(
      'bad_request',
      RETURN_URL_POLICY.allowExpoGo ? 'return_url must be a termwise:// (or exp://) deep link.' : 'return_url must be a termwise:// deep link.',
    );
  }
  return { provider: body.provider, return_url: body.return_url };
}

async function start(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const userId = requireUserId(ctx);

  let issued: Awaited<ReturnType<typeof issueOAuthState>>;
  try {
    issued = await issueOAuthState({ uid: userId, provider: request.provider, return_url: request.return_url }, requireEnv('OAUTH_STATE_SECRET'));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError('internal', 'Server is misconfigured (OAUTH_STATE_SECRET).');
  }
  const pkce = await createPkcePair();
  const redirectUri = oauthRedirectUri(requireEnv('SUPABASE_URL'));
  const authUrl =
    request.provider === 'google'
      ? googleAuthUrl({ clientId: requireEnv('GOOGLE_CLIENT_ID'), redirectUri, state: issued.token })
      : microsoftAuthUrl({ clientId: requireEnv('MICROSOFT_CLIENT_ID'), redirectUri, state: issued.token });

  // Flows nobody finished are useless after they expire; tidy them up as new ones start.
  const now = new Date().toISOString();
  const { error: cleanupError } = await ctx.supabaseAdmin.from('calendar_oauth_pending').delete().lt('expires_at', now);
  if (cleanupError) console.error(`calendar-oauth-start: pending cleanup failed (${cleanupError.code})`);

  const { error } = await ctx.supabaseAdmin.from('calendar_oauth_pending').insert({
    nonce: issued.state.nonce,
    user_id: userId,
    provider: request.provider,
    code_verifier: pkce.verifier,
    expires_at: new Date(issued.state.exp * 1000).toISOString(),
  });
  if (error) {
    console.error(`calendar-oauth-start: pending insert failed (${error.code})`);
    throw new HttpError('internal', "We couldn't start the calendar sign-in. Please try again.");
  }

  const response: CalendarOAuthStartResponse = { auth_url: withCodeChallenge(authUrl, pkce.challenge) };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(start)) };
