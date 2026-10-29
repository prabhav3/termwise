import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { router, Stack, ThemeProvider as NavigationThemeProvider, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button, ErrorBanner, NBText, Screen, ToastProvider, useToast, Wordmark } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useAppleCalendarAutoSync } from '@/lib/calendar/apple';
import type { AppError } from '@/lib/functions';
import { useNotificationRouting } from '@/lib/notifications';
import { useReplanOnForeground, useReplanOnInputChanges } from '@/lib/planner';
import { queryClient } from '@/lib/query-client';
import { fontAssets, navigationTheme, ThemeProvider, useTheme, useThemeMode } from '@/theme';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 200, fade: true });

// Deep links into the app (termwise://item/<id>) stack on top of the tabs, so Back works.
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <RootNavigator fontsReady={fontsLoaded || fontError !== null} />
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const theme = useTheme();
  const { ready: themeReady } = useThemeMode();
  const auth = useAuth();
  // The splash covers the first session restore + profile load only. Later profile loads (right
  // after signing in) keep the auth screens up instead of blanking the app.
  const [booted, setBooted] = useState(false);
  if (!booted && fontsReady && themeReady && auth.isReady) setBooted(true);

  useEffect(() => {
    if (booted) SplashScreen.hide();
  }, [booted]);

  if (!booted) return null;

  const signedIn = auth.status === 'signedIn';
  const profile = auth.profile;
  const profilePending = signedIn && profile === null && auth.profileError === null;
  const profileFailed = signedIn && profile === null && auth.profileError !== null;
  const needsOnboarding = signedIn && profile !== null && profile.onboarded_at === null;
  const inApp = signedIn && profile !== null && profile.onboarded_at !== null;
  const { colors, fonts } = theme;

  return (
    <NavigationThemeProvider value={navigationTheme(theme)}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {profileFailed ? (
        <ProfileProblem error={auth.profileError} onRetry={auth.refreshProfile} onSignOut={auth.signOut} />
      ) : (
        <Stack
          screenOptions={{
            headerShown: true,
            // `title`, not `headerTitle`: a string headerTitle wins over every screen's own title.
            title: '',
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: colors.ink,
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { fontFamily: fonts.display, color: colors.ink },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          {/* Explicit redirects: the default fallback lands on the bare `/(auth)` group, which has
              no index screen and shows "Unmatched route". */}
          <Stack.Protected guard={!signedIn || profilePending} redirectTo="/">
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          </Stack.Protected>

          <Stack.Protected guard={needsOnboarding} redirectTo={signedIn ? '/' : '/sign-in'}>
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack.Protected>

          <Stack.Protected guard={inApp} redirectTo={needsOnboarding ? '/onboarding' : '/sign-in'}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="upload" options={{ presentation: 'modal' }} />
            <Stack.Screen name="focus" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="item/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="course/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="review/[uploadId]" />
            <Stack.Screen name="course/[id]" />
            <Stack.Screen name="item/[id]" />
            <Stack.Screen name="textbook/[id]" />
            <Stack.Screen name="grades/[courseId]" />
            <Stack.Screen name="week/[start]" />
            <Stack.Screen name="integrations/index" />
            <Stack.Screen name="integrations/calendar" />
            <Stack.Screen name="integrations/canvas" />
            <Stack.Screen name="integrations/lms" />
            <Stack.Screen name="discrepancies" />
            <Stack.Screen name="share/[slug]" />
          </Stack.Protected>

          {/* Email links: reachable signed in or out (exchanging the code signs the student in). */}
          <Stack.Screen name="auth-callback" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        </Stack>
      )}
      <DeepLinkResume open={inApp} />
      {inApp ? <SignedInEffects /> : null}
    </NavigationThemeProvider>
  );
}

// ---- deep links that arrive while signed out ---------------------------------------------------

const RESUMABLE = /^\/(share|item)\/([^/?#]+)\/?$/;

/** "termwise://share/abc" or "exp://host:8081/--/item/123?x=1" -> "/share/abc" / "/item/123". */
function resumablePath(url: string): string | null {
  const marker = url.indexOf('/--/');
  const path = (marker >= 0 ? url.slice(marker + 3) : url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '/')).split(/[?#]/)[0];
  const match = RESUMABLE.exec(path);
  return match ? `/${match[1]}/${match[2]}` : null;
}

/**
 * Expo Router routes termwise://share/<slug> and termwise://item/<id> itself when the student
 * is signed in. When they are not, the guard sends them to sign-in (or onboarding) first; this
 * remembers the link and opens it once the app is unlocked.
 */
function DeepLinkResume({ open }: { open: boolean }) {
  const url = Linking.useLinkingURL();
  const handled = useRef<string | null>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (url && handled.current !== url) {
      handled.current = url;
      if (!open) pending.current = resumablePath(url);
    }
    const path = pending.current;
    if (!open || !path) return;
    // Let the guards settle on the tabs first, then stack the link on top of them.
    const timer = setTimeout(() => {
      pending.current = null;
      // Validated against RESUMABLE above; typed routes cannot see later-wave screens.
      router.push(path as Href);
    }, 0);
    return () => clearTimeout(timer);
  }, [url, open]);

  return null;
}

// ---- background work for a signed-in, onboarded student ------------------------------------------

function SignedInEffects() {
  const toast = useToast();
  const onError = (error: AppError) => {
    if (error.code === 'network') return; // the next foreground or edit retries quietly
    toast.show({ tone: 'warning', title: "Plan didn't update", message: error.message });
  };
  useReplanOnForeground(onError);
  useReplanOnInputChanges(onError);
  useAppleCalendarAutoSync();
  useNotificationRouting((path) => router.navigate(path as Href));
  return null;
}

// ---- signed in, but the profile row could not be loaded ---------------------------------------

function ProfileProblem({
  error,
  onRetry,
  onSignOut,
}: {
  error: AppError | null;
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const { spacing } = useTheme();
  const [busy, setBusy] = useState<'retry' | 'signOut' | null>(null);
  const run = (kind: 'retry' | 'signOut', action: () => Promise<void>) => {
    setBusy(kind);
    action().finally(() => setBusy(null));
  };

  return (
    <Screen scroll={false} contentContainerStyle={{ justifyContent: 'center', gap: spacing.lg }}>
      <Wordmark />
      <NBText variant="h1">We hit a snag.</NBText>
      <ErrorBanner
        title="Couldn't load your account"
        message={error?.message ?? "We couldn't load your profile. Check your connection and try again."}
      />
      <View style={{ gap: spacing.md }}>
        <Button label="Try again" fullWidth loading={busy === 'retry'} onPress={() => run('retry', onRetry)} />
        <Button
          label="Sign out"
          variant="secondary"
          fullWidth
          loading={busy === 'signOut'}
          onPress={() => run('signOut', onSignOut)}
        />
      </View>
    </Screen>
  );
}
