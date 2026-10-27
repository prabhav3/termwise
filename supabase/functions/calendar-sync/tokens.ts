// Access tokens for one calendar connection: the stored one while it is fresh, else a refresh
// (Microsoft rotates refresh tokens, so a returned one replaces the stored one).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudCalendarProvider } from '../_shared/api.ts';
import { type AccessTokenSource, ReauthRequiredError } from '../_shared/calendar-model.ts';
import { refreshGoogleToken } from '../_shared/google.ts';
import { requireEnv } from '../_shared/http.ts';
import { refreshMicrosoftToken } from '../_shared/microsoft.ts';
import { openSecret, sealSecret } from '../_shared/secrets.ts';

/** Refresh this long before the stored expiry so a token never dies mid-run. */
const EXPIRY_MARGIN_MS = 2 * 60_000;

interface SecretRow {
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
}

export async function tokenSource(adminDb: SupabaseClient, connectionId: string, provider: CloudCalendarProvider): Promise<AccessTokenSource> {
  const { data, error } = await adminDb
    .from('calendar_secrets')
    .select('refresh_token_enc, access_token_enc, access_token_expires_at')
    .eq('connection_id', connectionId)
    .maybeSingle()
    .overrideTypes<SecretRow, { merge: false }>();
  if (error) throw new Error(`calendar secret lookup failed (${error.code})`);

  let refreshToken = await openSecret(data?.refresh_token_enc);
  if (!refreshToken) throw new ReauthRequiredError(provider);
  let accessToken = await openSecret(data?.access_token_enc);
  let expiresAt = data?.access_token_expires_at ? Date.parse(data.access_token_expires_at) : 0;
  let refreshing: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const client =
      provider === 'google'
        ? { clientId: requireEnv('GOOGLE_CLIENT_ID'), clientSecret: requireEnv('GOOGLE_CLIENT_SECRET') }
        : { clientId: requireEnv('MICROSOFT_CLIENT_ID'), clientSecret: requireEnv('MICROSOFT_CLIENT_SECRET') };
    const tokens = provider === 'google' ? await refreshGoogleToken(client, refreshToken as string) : await refreshMicrosoftToken(client, refreshToken as string);
    accessToken = tokens.access_token;
    expiresAt = Date.now() + (Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : 3600) * 1000;
    const patch: Record<string, unknown> = {
      access_token_enc: await sealSecret(tokens.access_token),
      access_token_expires_at: new Date(expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      refreshToken = tokens.refresh_token;
      patch.refresh_token_enc = await sealSecret(tokens.refresh_token);
    }
    if (tokens.scope) patch.scope = tokens.scope;
    const { error: saveError } = await adminDb.from('calendar_secrets').update(patch).eq('connection_id', connectionId);
    if (saveError) console.error(`calendar-sync: token save failed (${saveError.code})`);
    return tokens.access_token;
  };

  return {
    get(forceRefresh = false): Promise<string> {
      if (!forceRefresh && accessToken && expiresAt - EXPIRY_MARGIN_MS > Date.now()) return Promise.resolve(accessToken);
      // Concurrent requests share one refresh.
      refreshing ??= refresh().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
  };
}
