// apple-token (auth: user) — POST { authorization_code } -> { stored }.
// Called by the app right after Sign in with Apple. Exchanges the single-use authorizationCode at
// Apple's /auth/token (client_secret = ES256 JWT from APPLE_TEAM_ID / APPLE_KEY_ID /
// APPLE_PRIVATE_KEY, client_id = the bundle id) and keeps the refresh token sealed in
// apple_secrets, so account deletion can revoke it (Apple's account-deletion requirement).
// Without the Apple secrets it answers { stored: false }: sign-in never depends on this call.
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { AppleTokenRequest, AppleTokenResponse } from '../_shared/api.ts';
import { appleCredentials, appleIdTokenSubject, AppleRequestError, exchangeAppleCode, hasAppleIdentity } from '../_shared/apple-auth.ts';
import { requireUserId } from '../_shared/auth.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { sealSecret } from '../_shared/secrets.ts';

function parseRequest(raw: unknown): AppleTokenRequest {
  if (typeof raw !== 'object' || raw === null) throw new HttpError('bad_request', 'Request body must be an object.');
  const code = (raw as Partial<Record<keyof AppleTokenRequest, unknown>>).authorization_code;
  if (typeof code !== 'string' || code.length === 0 || code.length > 2048 || /\s/.test(code)) {
    throw new HttpError('bad_request', 'authorization_code must be the code from Sign in with Apple.');
  }
  return { authorization_code: code };
}

async function appleToken(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const userId = requireUserId(ctx);

  const credentials = appleCredentials((name) => Deno.env.get(name));
  if (!credentials) {
    const response: AppleTokenResponse = { stored: false };
    return json(response);
  }

  let tokens: Awaited<ReturnType<typeof exchangeAppleCode>>;
  try {
    tokens = await exchangeAppleCode(credentials, request.authorization_code);
  } catch (err) {
    console.error(`apple-token: code exchange failed (${err instanceof AppleRequestError ? `${err.status} ${err.reason ?? ''}` : 'unknown'})`);
    throw new HttpError('upstream_error', "Apple didn't accept the sign-in code. Sign in with Apple again to retry.");
  }
  if (!tokens.refresh_token) {
    const response: AppleTokenResponse = { stored: false };
    return json(response);
  }

  // Only keep a token for the Apple ID this Termwise account actually signs in with.
  const appleUserId = appleIdTokenSubject(tokens.id_token);
  const { data: user, error: userError } = await ctx.supabaseAdmin.auth.admin.getUserById(userId);
  if (userError) {
    console.error(`apple-token: user lookup failed (${userError.status ?? userError.name})`);
    throw new HttpError('internal', 'Something went wrong. Please try again.');
  }
  if (!appleUserId || !hasAppleIdentity(user.user?.identities, appleUserId)) {
    throw new HttpError('bad_request', 'That Apple sign-in belongs to a different account.');
  }

  const { error } = await ctx.supabaseAdmin
    .from('apple_secrets')
    .upsert(
      { user_id: userId, refresh_token_enc: await sealSecret(tokens.refresh_token), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.error(`apple-token: store failed (${error.code})`);
    throw new HttpError('internal', 'Something went wrong. Please try again.');
  }
  const response: AppleTokenResponse = { stored: true };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(appleToken)) };
