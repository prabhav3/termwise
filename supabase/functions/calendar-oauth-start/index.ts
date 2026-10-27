// calendar-oauth-start (auth: user) — POST { provider, return_url } -> { auth_url }.
// Builds the Google / Microsoft consent URL with a signed, 10-minute state carrying the caller's
// id and the app deep link. The app opens it with WebBrowser.openAuthSessionAsync(auth_url,
// return_url); calendar-oauth-callback finishes the flow and redirects back to return_url.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CalendarOAuthStartRequest, CalendarOAuthStartResponse } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { googleAuthUrl } from '../_shared/google.ts';
import { handle, HttpError, json, readJson, requireEnv } from '../_shared/http.ts';
import { microsoftAuthUrl } from '../_shared/microsoft.ts';
import { isAllowedReturnUrl, oauthRedirectUri, signOAuthState } from '../_shared/oauth-state.ts';

function parseRequest(raw: unknown): CalendarOAuthStartRequest {
  if (typeof raw !== 'object' || raw === null) throw new HttpError('bad_request', 'Request body must be an object.');
  const body = raw as Partial<Record<keyof CalendarOAuthStartRequest, unknown>>;
  if (body.provider !== 'google' && body.provider !== 'microsoft') throw new HttpError('bad_request', 'provider must be google or microsoft.');
  if (!isAllowedReturnUrl(body.return_url)) {
    throw new HttpError('bad_request', 'return_url must be a termwise:// (or exp://) deep link.');
  }
  return { provider: body.provider, return_url: body.return_url };
}

async function start(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const userId = requireUserId(ctx);

  let state: string;
  try {
    state = await signOAuthState({ uid: userId, provider: request.provider, return_url: request.return_url }, requireEnv('OAUTH_STATE_SECRET'));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError('internal', 'Server is misconfigured (OAUTH_STATE_SECRET).');
  }
  const redirectUri = oauthRedirectUri(requireEnv('SUPABASE_URL'));
  const authUrl =
    request.provider === 'google'
      ? googleAuthUrl({ clientId: requireEnv('GOOGLE_CLIENT_ID'), redirectUri, state })
      : microsoftAuthUrl({ clientId: requireEnv('MICROSOFT_CLIENT_ID'), redirectUri, state });
  const response: CalendarOAuthStartResponse = { auth_url: authUrl };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(start)) };
