// Turns a finished consent into the caller's cloud connection (device_id '') and its encrypted
// tokens, with the service role. The tokens arrive already sealed from the pending row.
import type { SupabaseContext } from '@supabase/server';
import type { CloudCalendarProvider } from '../_shared/api.ts';
import { HttpError } from '../_shared/http.ts';

type Db = SupabaseContext['supabaseAdmin'];

const PROVIDER_NAMES: Record<CloudCalendarProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

export interface PendingTokens {
  account_email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  access_token_expires_at: string | null;
  scope: string | null;
}

const SAVE_FAILED = "We couldn't finish connecting your calendar. Please try again.";

function dbFailure(step: string, error: { code?: string } | null): HttpError {
  console.error(`calendar-oauth-finish: ${step} failed (${error?.code ?? 'no row'})`);
  return new HttpError('internal', SAVE_FAILED);
}

/** Upserts the connection for (userId, provider, '') and its secrets; returns the connection id. */
export async function storeConnection(db: Db, userId: string, provider: CloudCalendarProvider, tokens: PendingTokens): Promise<string> {
  const email = tokens.account_email;
  const { data: existing, error: lookupError } = await db
    .from('calendar_connections')
    .select('id, account_email')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('device_id', '')
    .maybeSingle()
    .overrideTypes<{ id: string; account_email: string | null }, { merge: false }>();
  if (lookupError) throw dbFailure('connection lookup', lookupError);

  // A different account means a different calendar: forget everything tied to the old one.
  const switchedAccount = existing !== null && email !== null && existing.account_email !== null && existing.account_email !== email;
  // Without a refresh token (new or stored) the connection would die within the hour.
  let hasRefreshToken = Boolean(tokens.refresh_token_enc);
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
    throw new HttpError(
      'upstream_auth',
      `${PROVIDER_NAMES[provider]} didn't allow offline access. Remove Termwise from your account's connected apps, then connect again.`,
    );
  }

  const { data: connection, error } = await db
    .from('calendar_connections')
    .upsert(
      {
        user_id: userId,
        provider,
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
  if (error || !connection) throw dbFailure('connection upsert', error);
  if (switchedAccount) {
    const { error: linkError } = await db.from('calendar_event_links').delete().eq('connection_id', connection.id);
    if (linkError) throw dbFailure('link cleanup', linkError);
  }

  const { error: secretError } = await db.from('calendar_secrets').upsert(
    {
      connection_id: connection.id,
      user_id: userId,
      access_token_enc: tokens.access_token_enc,
      access_token_expires_at: tokens.access_token_expires_at,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
      // Keep the stored refresh token when the provider didn't send a new one.
      ...(tokens.refresh_token_enc ? { refresh_token_enc: tokens.refresh_token_enc } : {}),
    },
    { onConflict: 'connection_id' },
  );
  if (secretError) throw dbFailure('secret upsert', secretError);
  return connection.id;
}
