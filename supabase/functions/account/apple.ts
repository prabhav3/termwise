// Sign in with Apple token revocation for account deletion. Apple asks apps that offer Sign in
// with Apple to revoke the user's tokens (POST /auth/revoke) when the account is deleted. Never
// throws: deletion goes ahead and the outcome is reported to the app.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppleRevocationOutcome } from '../_shared/api.ts';
import { appleCredentials, AppleRequestError, exchangeAppleCode, hasAppleIdentity, revokeAppleToken } from '../_shared/apple-auth.ts';
import { openSecret } from '../_shared/secrets.ts';

function describe(err: unknown): string {
  if (err instanceof AppleRequestError) return `${err.status} ${err.reason ?? ''}`.trim();
  return err instanceof Error ? err.name : 'unknown';
}

/**
 * Revokes the stored Apple refresh token, or one minted from `authorizationCode` (a fresh
 * re-authorization) when none is stored. `admin` must be the service-role client.
 */
export async function revokeAppleSignIn(
  admin: SupabaseClient,
  userId: string,
  authorizationCode: string | undefined,
): Promise<AppleRevocationOutcome> {
  try {
    const { data: stored, error } = await admin
      .from('apple_secrets')
      .select('refresh_token_enc')
      .eq('user_id', userId)
      .maybeSingle()
      .overrideTypes<{ refresh_token_enc: string }, { merge: false }>();
    if (error) {
      console.error(`account: apple token lookup failed (${error.code})`);
      return 'failed';
    }

    if (!stored && !authorizationCode) {
      const { data, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError) {
        console.error(`account: user lookup failed (${userError.status ?? userError.name})`);
        return 'failed';
      }
      return hasAppleIdentity(data.user?.identities) ? 'no_token' : 'not_linked';
    }

    const credentials = appleCredentials((name) => Deno.env.get(name));
    if (!credentials) return 'skipped';

    let refreshToken = await openSecret(stored?.refresh_token_enc);
    if (!refreshToken && authorizationCode) {
      refreshToken = (await exchangeAppleCode(credentials, authorizationCode)).refresh_token ?? null;
    }
    if (!refreshToken) return 'no_token';

    await revokeAppleToken(credentials, refreshToken, 'refresh_token');
    return 'revoked';
  } catch (err) {
    console.error(`account: apple token revocation failed (${describe(err)})`);
    return 'failed';
  }
}
