// account (auth: user) — POST { action: 'delete', apple_authorization_code? } ->
// { ok: true, apple_revocation }.
// Deletes the caller's uploaded syllabus files, revokes their Sign in with Apple token (Apple's
// account-deletion requirement), then deletes their auth user; every table row cascades from
// auth.users. Files go first so a failure leaves the account intact and retryable. Apple
// revocation never blocks deletion: a missing key or token, or an Apple error, is reported in
// `apple_revocation` instead. Required by App Store guideline 5.1.1(v).
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { AccountDeleteResponse, AccountRequest } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { revokeAppleSignIn } from './apple.ts';
import { listObjectPaths, removeObjects } from './storage.ts';

const BUCKET = 'syllabi';

function parseRequest(raw: unknown): AccountRequest {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof AccountRequest, unknown>>;
  if (body.action !== 'delete') throw new HttpError('bad_request', 'Unknown action.');
  const code = body.apple_authorization_code;
  if (code !== undefined && code !== null && (typeof code !== 'string' || code.length === 0 || code.length > 2048)) {
    throw new HttpError('bad_request', 'apple_authorization_code must be the code from Sign in with Apple.');
  }
  return typeof code === 'string' ? { action: 'delete', apple_authorization_code: code } : { action: 'delete' };
}

async function account(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const request = parseRequest(await readJson<unknown>(req));
  const userId = requireUserId(ctx);

  // Storage objects are foldered by user id: syllabi/<uid>/<upload_id>/<n>.<ext>.
  const paths = await listObjectPaths(ctx.supabaseAdmin, BUCKET, userId);
  await removeObjects(ctx.supabaseAdmin, BUCKET, paths);

  // Before deleteUser: the stored Apple token cascades away with the auth user.
  const appleRevocation = await revokeAppleSignIn(ctx.supabaseAdmin, userId, request.apple_authorization_code);

  const { error } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`account: auth user deletion failed (${error.status ?? error.name})`);
    throw new HttpError('internal', "We couldn't delete your account. Please try again.");
  }
  const response: AccountDeleteResponse = { ok: true, apple_revocation: appleRevocation };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(account)) };
