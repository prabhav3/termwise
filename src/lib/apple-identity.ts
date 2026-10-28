// Pure helpers for the Sign in with Apple parts of account deletion (no React Native imports).
import type { User } from '@supabase/supabase-js';

import type { AppleRevocationOutcome } from '@shared/api.ts';

/** True when the account has signed in with Apple (a linked identity, or Apple in app_metadata). */
export function usesAppleSignIn(user: Pick<User, 'identities' | 'app_metadata'> | null | undefined): boolean {
  if (!user) return false;
  if ((user.identities ?? []).some((identity) => identity.provider === 'apple')) return true;
  const { provider, providers } = user.app_metadata ?? {};
  return provider === 'apple' || (Array.isArray(providers) && providers.includes('apple'));
}

/**
 * After deletion: whether to tell the student that Termwise may still be listed under Sign in
 * with Apple on their Apple ID (Apple wasn't confirmed, the server has no Apple key, or Apple's
 * revoke didn't go through).
 */
export function appleAccessMayRemain(outcome: AppleRevocationOutcome, appleUser: boolean): boolean {
  if (outcome === 'no_token') return true;
  return appleUser && (outcome === 'failed' || outcome === 'skipped');
}

/** Where the student removes an app's Sign in with Apple access themselves. */
export const APPLE_SETTINGS_PATH = 'Settings › your name › Sign-In & Security › Sign in with Apple';
