// calendar-oauth-callback (auth: none, verify_jwt = false) — Google / Microsoft redirect here
// with ?code&state (or ?error&state). Verifies the signed state, exchanges the code, reads the
// account email, stores the connection (device_id '') and the encrypted tokens with the service
// role, then 302-redirects to the app's return_url with status=connected|error, provider, and a
// student-safe message on errors. A request whose state can't be verified gets a plain page:
// its return_url is untrusted, so it is never redirected to.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { CloudCalendarProvider } from '../_shared/api.ts';
import { ProviderError, ReauthRequiredError } from '../_shared/calendar-model.ts';
import { exchangeGoogleCode, fetchGoogleEmail, googleScopesSufficient, type OAuthTokenResponse } from '../_shared/google.ts';
import { HttpError, requireEnv } from '../_shared/http.ts';
import { exchangeMicrosoftCode, fetchMicrosoftEmail } from '../_shared/microsoft.ts';
import { appendQuery, type OAuthState, OAuthStateError, oauthRedirectUri, verifyOAuthState } from '../_shared/oauth-state.ts';
import { sealSecret } from '../_shared/secrets.ts';

type Db = SupabaseContext['supabaseAdmin'];

const PROVIDER_NAMES: Record<CloudCalendarProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

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
    headers: { Location: appendQuery(state.return_url, { provider: state.provider, ...params }), 'Cache-Control': 'no-store' },
  });
}

async function exchange(provider: CloudCalendarProvider, code: string, redirectUri: string): Promise<{ tokens: OAuthTokenResponse; email: string | null }> {
  if (provider === 'google') {
    const tokens = await exchangeGoogleCode(
      { clientId: requireEnv('GOOGLE_CLIENT_ID'), clientSecret: requireEnv('GOOGLE_CLIENT_SECRET') },
      code,
      redirectUri,
    );
    if (!googleScopesSufficient(tokens.scope)) {
      throw new CallbackError('Termwise needs access to Google Calendar and Google Tasks. Connect again and keep both boxes checked.');
    }
    return { tokens, email: await fetchGoogleEmail(tokens.access_token).catch(() => null) };
  }
  const tokens = await exchangeMicrosoftCode(
    { clientId: requireEnv('MICROSOFT_CLIENT_ID'), clientSecret: requireEnv('MICROSOFT_CLIENT_SECRET') },
    code,
    redirectUri,
  );
  return { tokens, email: await fetchMicrosoftEmail(tokens.access_token).catch(() => null) };
}

async function store(db: Db, state: OAuthState, tokens: OAuthTokenResponse, email: string | null): Promise<void> {
  const { data: existing, error: lookupError } = await db
    .from('calendar_connections')
    .select('id, account_email')
    .eq('user_id', state.uid)
    .eq('provider', state.provider)
    .eq('device_id', '')
    .maybeSingle()
    .overrideTypes<{ id: string; account_email: string | null }, { merge: false }>();
  if (lookupError) throw lookupError;

  // A different account means a different calendar: forget everything tied to the old one.
  const switchedAccount = existing !== null && email !== null && existing.account_email !== null && existing.account_email !== email;
  // Without a refresh token (new or stored) the connection would die within the hour.
  let hasRefreshToken = Boolean(tokens.refresh_token);
  if (!hasRefreshToken && existing && !switchedAccount) {
    const { data: secret } = await db
      .from('calendar_secrets')
      .select('refresh_token_enc')
      .eq('connection_id', existing.id)
      .maybeSingle()
      .overrideTypes<{ refresh_token_enc: string | null }, { merge: false }>();
    hasRefreshToken = Boolean(secret?.refresh_token_enc);
  }
  if (!hasRefreshToken) {
    throw new CallbackError(
      `${PROVIDER_NAMES[state.provider]} didn't allow offline access. Remove Termwise from your account's connected apps, then connect again.`,
    );
  }

  const { data: connection, error } = await db
    .from('calendar_connections')
    .upsert(
      {
        user_id: state.uid,
        provider: state.provider,
        device_id: '',
        account_email: email ?? existing?.account_email ?? null,
        status: 'active',
        last_error: null,
        ...(switchedAccount ? { external_calendar_id: null, task_list_id: null, sync_cursor: null } : {}),
      },
      { onConflict: 'user_id,provider,device_id' },
    )
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (error || !connection) throw error ?? new Error('connection upsert returned no row');
  if (switchedAccount) {
    const { error: linkError } = await db.from('calendar_event_links').delete().eq('connection_id', connection.id);
    if (linkError) throw linkError;
  }

  const expiresIn = Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : 3600;
  const { error: secretError } = await db.from('calendar_secrets').upsert(
    {
      connection_id: connection.id,
      user_id: state.uid,
      access_token_enc: await sealSecret(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: tokens.scope ?? null,
      updated_at: new Date().toISOString(),
      // Keep the stored refresh token when the provider didn't send a new one.
      ...(tokens.refresh_token ? { refresh_token_enc: await sealSecret(tokens.refresh_token) } : {}),
    },
    { onConflict: 'connection_id' },
  );
  if (secretError) throw secretError;
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
    state = await verifyOAuthState(rawState, requireEnv('OAUTH_STATE_SECRET'));
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

  const providerError = params.get('error');
  if (providerError) {
    const cancelled = providerError === 'access_denied' || providerError === 'consent_required';
    return redirect(state, {
      status: 'error',
      message: cancelled ? 'Calendar access was not granted.' : `${PROVIDER_NAMES[state.provider]} sign-in failed. Please try again.`,
    });
  }
  const code = params.get('code');
  if (!code) return redirect(state, { status: 'error', message: 'The sign-in response was incomplete. Please try again.' });

  try {
    const { tokens, email } = await exchange(state.provider, code, oauthRedirectUri(requireEnv('SUPABASE_URL')));
    await store(ctx.supabaseAdmin, state, tokens, email);
    return redirect(state, { status: 'connected' });
  } catch (err) {
    if (!(err instanceof CallbackError)) {
      const detail = err instanceof Error ? err.name : typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'unknown';
      console.error(`calendar-oauth-callback: ${state.provider} connection failed (${detail})`);
    }
    return redirect(state, { status: 'error', message: failureMessage(err, state.provider) });
  }
}

export default { fetch: withSupabase({ auth: 'none' }, callback) };
