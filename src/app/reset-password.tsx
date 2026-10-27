import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorBanner, LoadingBlock, NBText, Screen, TextField, Wordmark } from '@/components/ui';
import { validateNewPassword } from '@/lib/auth';
import { exchangeAuthCode } from '@/lib/auth-links';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';

type Phase = { kind: 'verifying' } | { kind: 'ready' } | { kind: 'linkError'; message: string } | { kind: 'done' };

/** termwise://reset-password?code=… — the link from "Forgot password". */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const { spacing } = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: 'verifying' });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void exchangeAuthCode(params).then((result) => {
      if (cancelled) return;
      setPhase(result.ok ? { kind: 'ready' } : { kind: 'linkError', message: result.message });
    });
    return () => {
      cancelled = true;
    };
    // The code is single-use: exchange it once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.error_description]);

  const save = async () => {
    const problem = validateNewPassword(password);
    setPasswordError(problem);
    setFormError(null);
    if (problem) {
      haptic('warning');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      haptic('error');
      setFormError("Couldn't save your new password. Please try again.");
      return;
    }
    haptic('success');
    setPhase({ kind: 'done' });
  };

  return (
    <Screen contentContainerStyle={{ gap: spacing.xl }}>
      <Wordmark />
      {phase.kind === 'verifying' ? (
        <View style={{ gap: spacing.md }}>
          <NBText variant="h1">Checking your link…</NBText>
          <LoadingBlock height={56} />
        </View>
      ) : phase.kind === 'linkError' ? (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="h1">That link didn&apos;t work.</NBText>
          <ErrorBanner title="Couldn't open the reset link" message={phase.message} />
          <Button label="Request a new link" size="lg" fullWidth onPress={() => router.replace('/forgot-password')} />
        </View>
      ) : phase.kind === 'done' ? (
        <View style={{ gap: spacing.lg }}>
          <Card color="green" shadow="lg" style={{ gap: spacing.sm }}>
            <NBText variant="h2">Password updated.</NBText>
            <NBText variant="body">You&apos;re signed in with your new password.</NBText>
          </Card>
          <Button label="Continue" size="lg" fullWidth onPress={() => router.replace('/')} />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <NBText variant="display">Pick a new password.</NBText>
          {formError ? <ErrorBanner title="Not saved" message={formError} /> : null}
          <Card style={{ gap: spacing.lg }}>
            <TextField
              label="New password"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (passwordError) setPasswordError(null);
              }}
              error={passwordError}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
            <Button label="Save password" size="lg" fullWidth loading={saving} onPress={() => void save()} />
          </Card>
        </View>
      )}
    </Screen>
  );
}
