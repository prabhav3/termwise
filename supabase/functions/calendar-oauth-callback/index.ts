// calendar-oauth-callback (auth: none, verify_jwt = false) — Google / Microsoft redirect here
// with ?code&state (or ?error&state). Verifies the signed state, then claims the one-time pending
// row calendar-oauth-start stored for its nonce (unknown, used, or expired → refused, so a state
// can't be replayed). Exchanges the code with that row's PKCE verifier, reads the account email,
// and parks the encrypted tokens on the pending row — it never creates a connection itself. It
// 302-redirects to the app's return_url with status=authorized, provider, and a one-time
// `pending` code; the app hands that to calendar-oauth-finish, which attaches the calendar only
// to the Termwise account that started the flow. Errors redirect with status=error and a
// student-safe message. A request whose state can't be verified gets a plain page: its
// return_url is untrusted, so it is never redirected to.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CloudCalendarProvider } from '../_shared/api.ts';
import { oauthTokenRequest, ProviderError, ReauthRequiredError } from '../_shared/calendar-model.ts';
import { fetchGoogleEmail, googleScopesSufficient, type OAuthTokenResponse } from '../_shared/google.ts';
import { HttpError, requireEnv } from '../_shared/http.ts';
import { fetchMicrosoftEmail, MICROSOFT_SCOPES } from '../_shared/microsoft.ts';
import {
  appendQuery,
  createFinishCode,
  hashFinishCode,
  OAUTH_FINISH_TTL_SECONDS,
  type OAuthState,
  OAuthStateError,
  oauthRedirectUri,
  type ReturnUrlPolicy,
  verifyOAuthState,
} from '../_shared/oauth-state.ts';
import { sealSecret } from '../_shared/secrets.ts';

type Db = SupabaseContext['supabaseAdmin'];

const PROVIDER_NAMES: Record<CloudCalendarProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

/** Same policy as calendar-oauth-start: exp:// return URLs only with ALLOW_EXPO_GO_RETURN=1. */
const RETURN_URL_POLICY: ReturnUrlPolicy = { allowExpoGo: Deno.env.get('ALLOW_EXPO_GO_RETURN') === '1' };

const TOKEN_URLS: Record<CloudCalendarProvider, string> = {
  google: 'https://oauth2.googleapis.com/token',
  microsoft: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

/** A failure whose message is safe to show the student in the app. */
class CallbackError extends Error {}

function plainPage(status: number, message: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Termwise</title></head><body style="font-family:system-ui,sans-serif;background:#FFF4DE;color:#111;padding:24px"><h1 style="font-size:22px">Termwise</h1><p>${message}</p></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

function redirect(state: OAuthState, params: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: appendQuery(state.return_url, { provider: state.provider, ...params }),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * Marks the pending row for this state used and returns its PKCE verifier, or null when there is
 * no unused, unexpired row issued for the same account and provider. One UPDATE, so two
 * concurrent redirects with the same state can't both claim it.
 */
async function claimPending(db: Db, state: OAuthState): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('calendar_oauth_pending')
    .update({ used_at: now })
    .eq('nonce', state.nonce)
    .eq('user_id', state.uid)
    .eq('provider', state.provider)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('code_verifier')
    .maybeSingle()
    .overrideTypes<{ code_verifier: string }, { merge: false }>();
  if (error) throw error;
  return data?.code_verifier ?? null;
}

async function discardPending(db: Db, nonce: string): Promise<void> {
  const { error } = await db.from('calendar_oauth_pending').delete().eq('nonce', nonce);
  if (error) console.error(`calendar-oauth-callback: pending cleanup failed (${error.code})`);
}

/** Authorization code -> tokens, proving possession of the PKCE verifier. */
function exchangeCode(provider: CloudCalendarProvider, code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokenResponse> {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  if (provider === 'google') {
    params.client_id = requireEnv('GOOGLE_CLIENT_ID');
    params.client_secret = requireEnv('GOOGLE_CLIENT_SECRET');
  } else {
    params.client_id = requireEnv('MICROSOFT_CLIENT_ID');
    params.client_secret = requireEnv('MICROSOFT_CLIENT_SECRET');
    params.scope = MICROSOFT_SCOPES.join(' ');
  }
  return oauthTokenRequest<OAuthTokenResponse>(provider, TOKEN_URLS[provider], params);
}

async function exchange(
  provider: CloudCalendarProvider,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ tokens: OAuthTokenResponse; email: string | null }> {
  const tokens = await exchangeCode(provider, code, redirectUri, codeVerifier);
  if (provider === 'google') {
    if (!googleScopesSufficient(tokens.scope)) {
      throw new CallbackError('Termwise needs access to Google Calendar and Google Tasks. Connect again and keep both boxes checked.');
    }
    return { tokens, email: await fetchGoogleEmail(tokens.access_token).catch(() => null) };
  }
  return { tokens, email: await fetchMicrosoftEmail(tokens.access_token).catch(() => null) };
}

/** Parks the sealed tokens on the claimed row; returns the one-time code for the app. */
async function park(db: Db, state: OAuthState, tokens: OAuthTokenResponse, email: string | null): Promise<string> {
  const finishCode = createFinishCode();
  const expiresIn = Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : 3600;
  const { data, error } = await db
    .from('calendar_oauth_pending')
    .update({
      finish_code_hash: await hashFinishCode(finishCode),
      account_email: email,
      access_token_enc: await sealSecret(tokens.access_token),
      refresh_token_enc: tokens.refresh_token ? await sealSecret(tokens.refresh_token) : null,
      access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: tokens.scope ?? null,
      expires_at: new Date(Date.now() + OAUTH_FINISH_TTL_SECONDS * 1000).toISOString(),
    })
    .eq('nonce', state.nonce)
    .select('nonce')
    .maybeSingle()
    .overrideTypes<{ nonce: string }, { merge: false }>();
  if (error) throw error;
  if (!data) throw new CallbackError('This sign-in took too long to finish. Please connect again.');
  return finishCode;
}

function failureMessage(err: unknown, provider: CloudCalendarProvider): string {
  const name = PROVIDER_NAMES[provider];
  if (err instanceof CallbackError) return err.message;
  if (err instanceof ReauthRequiredError) return `${name} sign-in expired before it finished. Please try again.`;
  if (err instanceof ProviderError) return `${name} didn't complete the connection. Please try again.`;
  if (err instanceof HttpError) return err.message;
  return "We couldn't finish connecting your calendar. Please try again.";
}

async function callback(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'GET') return plainPage(405, 'This address only handles calendar sign-in redirects.');
  const params = new URL(req.url).searchParams;
  const rawState = params.get('state');
  if (!rawState) return plainPage(400, 'This sign-in link is incomplete. Go back to Termwise and connect your calendar again.');

  let state: OAuthState;
  try {
    state = await verifyOAuthState(rawState, requireEnv('OAUTH_STATE_SECRET'), Date.now(), RETURN_URL_POLICY);
  } catch (err) {
    if (err instanceof OAuthStateError) {
      const message =
        err.reason === 'expired'
          ? 'This sign-in link expired. Go back to Termwise and connect your calendar again.'
          : "This sign-in link isn't valid. Go back to Termwise and connect your calendar again.";
      return plainPage(400, message);
    }
    console.error('calendar-oauth-callback: state check failed', err instanceof Error ? err.name : 'unknown');
    return plainPage(500, 'Calendar sign-in is not available right now.');
  }

  let codeVerifier: string | null;
  try {
    codeVerifier = await claimPending(ctx.supabaseAdmin, state);
  } catch (err) {
    const detail = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'unknown';
    console.error(`calendar-oauth-callback: pending lookup failed (${detail})`);
    return redirect(state, { status: 'error', message: "We couldn't finish connecting your calendar. Please try again." });
  }
  if (!codeVerifier) {
    return redirect(state, { status: 'error', message: 'This sign-in link was already used or has expired. Please connect again.' });
  }

  const providerError = params.get('error');
  if (providerError) {
    await discardPending(ctx.supabaseAdmin, state.nonce);
    const cancelled = providerError === 'access_denied' || providerError === 'consent_required';
    return redirect(state, {
      status: 'error',
      message: cancelled ? 'Calendar access was not granted.' : `${PROVIDER_NAMES[state.provider]} sign-in failed. Please try again.`,
    });
  }
  const code = params.get('code');
  if (!code) {
    await discardPending(ctx.supabaseAdmin, state.nonce);
    return redirect(state, { status: 'error', message: 'The sign-in response was incomplete. Please try again.' });
  }

  try {
    const { tokens, email } = await exchange(state.provider, code, oauthRedirectUri(requireEnv('SUPABASE_URL')), codeVerifier);
    const finishCode = await park(ctx.supabaseAdmin, state, tokens, email);
    return redirect(state, { status: 'authorized', pending: finishCode });
  } catch (err) {
    if (!(err instanceof CallbackError)) {
      const detail = err instanceof Error ? err.name : typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'unknown';
      console.error(`calendar-oauth-callback: ${state.provider} connection failed (${detail})`);
    }
    await discardPending(ctx.supabaseAdmin, state.nonce);
    return redirect(state, { status: 'error', message: failureMessage(err, state.provider) });
  }
}

export default { fetch: withSupabase({ auth: 'none' }, callback) };
