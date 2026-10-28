// Sign in with Apple token revocation for account deletion. Apple asks apps that offer Sign in
// with Apple to revoke the user's tokens (POST /auth/revoke) when the account is deleted.
// prepareAppleRevocation runs before anything is deleted, so an Apple account without a stored
// token can be sent back to re-authorize while it still exists; revokeAppleSignIn never throws:
// deletion goes ahead and the outcome is reported to the app.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountRequest, AppleRevocationOutcome } from '../_shared/api.ts';
import {
  type AppleCredentials,
  appleCredentials,
  AppleRequestError,
  appleRevocationStep,
  exchangeAppleCode,
  hasAppleIdentity,
  revokeAppleToken,
} from '../_shared/apple-auth.ts';
import { openSecret } from '../_shared/secrets.ts';

export type AppleRevocationPlan =
  | { kind: 'revoke'; credentials: AppleCredentials; refreshTokenEnc: string | null; authorizationCode: string | undefined }
  /** The app must run Sign in with Apple again and retry with the code (or skip). */
  | { kind: 'reauth_required' }
  /** Nothing to send to Apple. */
  | { kind: 'done'; outcome: AppleRevocationOutcome };

function describe(err: unknown): string {
  if (err instanceof AppleRequestError) return `${err.status} ${err.reason ?? ''}`.trim();
  return err instanceof Error ? err.name : 'unknown';
}

/**
 * Looks up the stored Apple refresh token (and, without one, whether the user signed in with
 * Apple) and decides what deletion does about it. Lookup failures never block deletion: they
 * report 'failed'. `admin` must be the service-role client.
 */
export async function prepareAppleRevocation(admin: SupabaseClient, userId: string, request: AccountRequest): Promise<AppleRevocationPlan> {
  try {
    const { data: stored, error } = await admin
      .from('apple_secrets')
      .select('refresh_token_enc')
      .eq('user_id', userId)
      .maybeSingle()
      .overrideTypes<{ refresh_token_enc: string }, { merge: false }>();
    if (error) {
      console.error(`account: apple token lookup failed (${error.code})`);
      return { kind: 'done', outcome: 'failed' };
    }

    const authorizationCode = request.apple_authorization_code;
    let appleIdentity = true;
    if (!stored && !authorizationCode) {
      const { data, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError) {
        console.error(`account: user lookup failed (${userError.status ?? userError.name})`);
        return { kind: 'done', outcome: 'failed' };
      }
      appleIdentity = hasAppleIdentity(data.user?.identities);
    }

    const credentials = appleCredentials((name) => Deno.env.get(name));
    const step = appleRevocationStep({
      storedToken: Boolean(stored),
      authorizationCode: Boolean(authorizationCode),
      skipRequested: request.skip_apple_revocation === true,
      credentials: credentials !== null,
      appleIdentity,
    });
    if (step === 'revoke' && credentials) {
      return { kind: 'revoke', credentials, refreshTokenEnc: stored?.refresh_token_enc ?? null, authorizationCode };
    }
    if (step === 'reauth_required') return { kind: 'reauth_required' };
    return { kind: 'done', outcome: step === 'revoke' ? 'skipped' : step };
  } catch (err) {
    console.error(`account: apple token lookup failed (${describe(err)})`);
    return { kind: 'done', outcome: 'failed' };
  }
}

/**
 * Revokes the stored Apple refresh token, or one minted from the fresh authorization code when
 * none is stored. Call it before deleteUser: the stored token cascades away with the auth user.
 */
export async function revokeAppleSignIn(plan: AppleRevocationPlan): Promise<AppleRevocationOutcome> {
  if (plan.kind === 'done') return plan.outcome;
  if (plan.kind === 'reauth_required') return 'no_token';
  try {
    let refreshToken = await openSecret(plan.refreshTokenEnc);
    if (!refreshToken && plan.authorizationCode) {
      refreshToken = (await exchangeAppleCode(plan.credentials, plan.authorizationCode)).refresh_token ?? null;
    }
    if (!refreshToken) return 'no_token';

    await revokeAppleToken(plan.credentials, refreshToken, 'refresh_token');
    return 'revoked';
  } catch (err) {
    console.error(`account: apple token revocation failed (${describe(err)})`);
    return 'failed';
  }
}
