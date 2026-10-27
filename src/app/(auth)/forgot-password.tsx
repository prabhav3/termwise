import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorBanner, IconButton, NBText, Screen, TextField } from '@/components/ui';
import { useAuth, validateEmail } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

export default function ForgotPasswordScreen() {
  const { sendPasswordReset } = useAuth();
  const { spacing } = useTheme();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    const problem = validateEmail(email);
    setEmailError(problem);
    setFormError(null);
    if (problem) {
      haptic('warning');
      return;
    }
    setSending(true);
    try {
      await sendPasswordReset(email);
      haptic('success');
      setSentTo(email.trim());
    } catch (error) {
      haptic('error');
      setFormError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: spacing.xl }}>
        <IconButton icon="chevron.left" fallback="‹" label="Back to sign in" onPress={() => router.back()} />
        <View style={{ gap: spacing.sm }}>
          <NBText variant="display">Reset your password.</NBText>
          <NBText variant="body" color="muted">
            {"It happens. We'll email you a link to pick a new one."}
          </NBText>
        </View>

        {sentTo ? (
          <>
            <Card color="green" shadow="lg" style={{ gap: spacing.sm }}>
              <NBText variant="h2">Link sent.</NBText>
              <NBText variant="body">
                {`If ${sentTo} has a Termwise account, a reset link is on its way. It can take a minute — check spam too.`}
              </NBText>
            </Card>
            <Button label="Back to sign in" size="lg" fullWidth onPress={() => router.back()} />
            <Button
              label="Use a different email"
              variant="ghost"
              style={{ alignSelf: 'center' }}
              onPress={() => setSentTo(null)}
            />
          </>
        ) : (
          <>
            {formError ? <ErrorBanner title="Couldn't send the link" message={formError} /> : null}
            <Card style={{ gap: spacing.lg }}>
              <TextField
                label="Email"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (emailError) setEmailError(null);
                }}
                error={emailError}
                placeholder="you@school.edu"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={() => void submit()}
              />
              <Button label="Send reset link" size="lg" fullWidth loading={sending} onPress={() => void submit()} />
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}
