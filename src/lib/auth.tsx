import { isAuthError, isAuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { profileQueryOptions } from '@/data/profile';
import { queryKeys } from '@/data/keys';
import type { Profile } from '@/types/db';

import { AppError, storeAppleToken, toAppError } from './functions';
import { cancelTriageNotifications } from './notifications';
import { queryClient } from './query-client';
import { supabase } from './supabase';

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  /** Session restored and, when signed in, the profile fetch has settled (keeps the splash up until then). */
  isReady: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Set when a signed-in user's profile could not be loaded. */
  profileError: AppError | null;
  refreshProfile: () => Promise<void>;
  /** Sign in with Apple is offered only where the device supports it. */
  appleAuthAvailable: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** `needsConfirmation` when the project requires email confirmation before the first sign-in. */
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>;
  /** Resolves 'canceled' when the student closes the Apple sheet (not an error). */
  signInWithApple: () => Promise<'signedIn' | 'canceled'>;
  /**
   * Runs Sign in with Apple again (no scopes) for a fresh, single-use authorizationCode, e.g. so
   * account deletion can revoke Apple's tokens. 'canceled' when the student closes the sheet.
   */
  reauthorizeWithApple: () => Promise<string | 'canceled'>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---- form validation (shared by the auth screens) --------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Student-facing problem with an email address, or null when it looks fine. */
export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Enter your email address.';
  if (!EMAIL.test(value)) return "That doesn't look like an email address.";
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return 'Mix letters and at least one number.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Tell us what to call you.';
  if (value.length > 60) return 'Keep it under 60 characters.';
  return null;
}

/** Friendly copy for Supabase Auth failures. */
function authError(error: unknown, fallback: string): AppError {
  if (isAuthRetryableFetchError(error)) {
    return new AppError('network', "Couldn't reach Termwise. Check your connection and try again.", { cause: error });
  }
  if (!isAuthError(error)) return toAppError(error);
  const say = (message: string) => new AppError('auth', message, { status: error.status ?? null, cause: error });
  switch (error.code) {
    case 'invalid_credentials':
      return say("That email and password don't match. Try again or reset your password.");
    case 'email_not_confirmed':
      return say('Confirm your email first. Check your inbox for the link we sent.');
    case 'user_already_exists':
    case 'email_exists':
      return say("There's already an account with this email. Try signing in instead.");
    case 'weak_password':
      return say('Pick a stronger password: at least 8 characters, mixing letters and numbers.');
    case 'email_address_invalid':
      return say("That email address doesn't look right.");
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return say('Too many tries in a row. Wait a minute, then try again.');
    case 'signup_disabled':
      return say('New sign-ups are paused right now. Please try again later.');
    default:
      return say(fallback);
  }
}

async function randomNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  // Apple receives the SHA-256 hash; Supabase receives the raw value and hashes it to compare.
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

function isAppleCancel(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ERR_REQUEST_CANCELED';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setRestored(true);
      })
      .catch(() => {
        if (active) setRestored(true);
      });
    // Never call other supabase.auth methods inside this callback (supabase-js deadlock guidance).
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setRestored(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAuthAvailable(available);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const userId = session?.user.id ?? null;

  // Another account's cached rows must never leak into this one: drop everything except the
  // (possibly in-flight) profile query of the account now signed in.
  useEffect(() => {
    if (lastUserId.current !== null && lastUserId.current !== userId) {
      queryClient.removeQueries({
        predicate: (query) => !(userId && query.queryKey[0] === 'profile' && query.queryKey[1] === userId),
      });
    }
    lastUserId.current = userId;
  }, [userId]);

  const profileQuery = useQuery({
    ...profileQueryOptions(userId ?? 'signed-out'),
    enabled: userId !== null,
    retry: 2,
  });

  const status: AuthStatus = !restored ? 'restoring' : userId ? 'signedIn' : 'signedOut';
  const profile = userId ? (profileQuery.data ?? null) : null;
  const profileFailed = userId !== null && !profileQuery.isPending && !profile;
  const profileQueryError = profileQuery.error;
  const profileError = useMemo<AppError | null>(() => {
    if (!profileFailed) return null;
    return profileQueryError
      ? toAppError(profileQueryError)
      : new AppError('not_found', "We couldn't find your profile. Try again, or sign out and back in.");
  }, [profileFailed, profileQueryError]);
  const isReady = restored && (userId === null || !profileQuery.isPending);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isReady,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      appleAuthAvailable,
      refreshProfile: async () => {
        if (!userId) return;
        await queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw authError(error, "Couldn't sign you in. Please try again.");
      },
      signUp: async ({ email, password, displayName }) => {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: Linking.createURL('/auth-callback'),
          },
        });
        if (error) throw authError(error, "Couldn't create your account. Please try again.");
        return { needsConfirmation: data.session === null };
      },
      signInWithApple: async () => {
        const nonce = await randomNonce();
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: nonce.hashed,
          });
        } catch (error) {
          if (isAppleCancel(error)) return 'canceled';
          throw new AppError('auth', "Sign in with Apple didn't finish. Please try again.", { cause: error });
        }
        if (!credential.identityToken) {
          throw new AppError('auth', "Apple didn't return a sign-in token. Please try again.");
        }
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: nonce.raw,
        });
        if (error) throw authError(error, "Couldn't sign you in with Apple. Please try again.");

        // Lets the server keep Apple's refresh token so deleting the account can revoke it
        // (Apple's account-deletion rule). Best effort: it never blocks or fails sign-in.
        const appleToken = credential.authorizationCode
          ? storeAppleToken({ authorization_code: credential.authorizationCode }).catch(() => undefined)
          : Promise.resolve(undefined);

        // Apple shares the name only on the very first authorization: keep it.
        const given = credential.fullName?.givenName ?? null;
        const family = credential.fullName?.familyName ?? null;
        const fullName = [given, family].filter(Boolean).join(' ');
        if (fullName && data.user) {
          await supabase.auth.updateUser({ data: { full_name: fullName, given_name: given, family_name: family } });
          await supabase.from('profiles').update({ display_name: fullName }).eq('id', data.user.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.profile(data.user.id) });
        }
        await appleToken;
        return 'signedIn';
      },
      reauthorizeWithApple: async () => {
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
        } catch (error) {
          if (isAppleCancel(error)) return 'canceled';
          throw new AppError('auth', "Confirming with Apple didn't finish. Please try again.", { cause: error });
        }
        if (!credential.authorizationCode) {
          throw new AppError('auth', "Apple didn't return a confirmation code. Please try again.");
        }
        return credential.authorizationCode;
      },
      sendPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: Linking.createURL('/reset-password'),
        });
        if (error) throw authError(error, "Couldn't send the reset email. Please try again.");
      },
      signOut: async () => {
        await cancelTriageNotifications();
        const { error } = await supabase.auth.signOut();
        // A failed server-side revoke still clears the local session; the student is signed out.
        if (error && isAuthRetryableFetchError(error)) await supabase.auth.signOut({ scope: 'local' });
      },
    }),
    [status, isReady, session, profile, profileError, appleAuthAvailable, userId],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>.');
  return value;
}

/** The signed-in student's profile; null while signed out or loading. */
export function useProfile(): Profile | null {
  return useAuth().profile;
}
