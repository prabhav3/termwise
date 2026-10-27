// account (auth: user) — POST { action: 'delete' } -> { ok: true }.
// Deletes the caller's uploaded syllabus files, then their auth user; every table row cascades
// from auth.users. Files go first so a failure leaves the account intact and retryable.
// Required by App Store guideline 5.1.1(v).
import { type SupabaseContext, withSupabase } from '@supabase/server';
import type { AccountRequest, OkResponse } from '../_shared/api.ts';
import { requireUserId } from '../_shared/auth.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { listObjectPaths, removeObjects } from './storage.ts';

const BUCKET = 'syllabi';

async function account(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError('bad_request', 'Use POST.', 405);
  const body = await readJson<Partial<AccountRequest> | null>(req);
  if (body?.action !== 'delete') throw new HttpError('bad_request', 'Unknown action.');
  const userId = requireUserId(ctx);

  // Storage objects are foldered by user id: syllabi/<uid>/<upload_id>/<n>.<ext>.
  const paths = await listObjectPaths(ctx.supabaseAdmin, BUCKET, userId);
  await removeObjects(ctx.supabaseAdmin, BUCKET, paths);

  const { error } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`account: auth user deletion failed (${error.status ?? error.name})`);
    throw new HttpError('internal', "We couldn't delete your account. Please try again.");
  }
  const response: OkResponse = { ok: true };
  return json(response);
}

export default { fetch: withSupabase({ auth: 'user' }, handle(account)) };
