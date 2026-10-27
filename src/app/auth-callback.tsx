import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorBanner, LoadingBlock, NBText, Screen, Wordmark } from '@/components/ui';
import { exchangeAuthCode } from '@/lib/auth-links';
import { useTheme } from '@/theme';

/** termwise://auth-callback?code=… — the "confirm your email" link from sign-up. */
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const { spacing } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void exchangeAuthCode(params).then((result) => {
      if (cancelled) return;
      if (result.ok) router.replace('/');
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
    // The code is single-use: exchange it once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.error_description]);

  return (
    <Screen scroll={false} contentContainerStyle={{ justifyContent: 'center', gap: spacing.lg }}>
      <Wordmark />
      {error ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="h1">That link didn&apos;t work.</NBText>
          <ErrorBanner title="Couldn't confirm your email" message={error} />
          <Button label="Go to sign in" size="lg" fullWidth onPress={() => router.replace('/sign-in')} />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <NBText variant="h1">Confirming your email…</NBText>
          <LoadingBlock height={56} />
        </View>
      )}
    </Screen>
  );
}
