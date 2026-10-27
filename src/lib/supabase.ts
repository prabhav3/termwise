// The one Supabase client for the app (Auth, PostgREST, Storage, Realtime, Edge Functions).
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/data/database';

// EXPO_PUBLIC_* variables are inlined at build time, so they must be read with literal names.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.example to .env, fill in your project values, and restart Metro with `npx expo start --clear`.',
  );
}

/** Project URL without a trailing slash, for building Edge Function links. */
export const SUPABASE_URL = url.replace(/\/+$/, '');

export const supabase = createClient<Database>(SUPABASE_URL, publishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps never receive sessions in a URL fragment. Email links (sign-up confirmation,
    // password reset) carry a PKCE `code` that src/app/auth-callback.tsx and
    // src/app/reset-password.tsx exchange for a session.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// React Native cannot tell supabase-js when the app is in the foreground: refresh tokens only
// while active (supabase-js guidance). Registered once, at module load.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
