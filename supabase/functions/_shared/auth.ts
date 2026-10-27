// Auth helpers for functions wrapped in @supabase/server `withSupabase({ auth: 'user' })`.
// Typed structurally so callers don't need an import-map entry for @supabase/server here.
import { HttpError } from './http.ts';

export interface UserClaimsContext {
  userClaims: { id: string } | null;
}

/** The caller's auth user id, or a 401 when the context carries no user (e.g. a key-only request). */
export function requireUserId(ctx: UserClaimsContext): string {
  const id = ctx.userClaims?.id;
  if (!id) throw new HttpError('unauthorized', 'Please sign in again.');
  return id;
}
