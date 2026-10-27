import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Card, Divider, ErrorBanner, IconButton, NBText, Screen, TextField, Wordmark } from '@/components/ui';
import { useAuth, validateEmail } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

export default function SignInScreen() {
  const { signIn, signInWithApple, appleAuthAvailable, status } = useAuth();
  const theme = useTheme();
  const { spacing, radius } = theme;
  const passwordRef = useRef<TextInputInstance>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'apple' | null>(null);
  const [method, setMethod] = useState<'password' | 'apple' | null>(null);
  // Signed in, profile still loading: keep showing progress until the guard moves on.
  const working = busy ?? (status === 'signedIn' ? method : null);

  const submit = async () => {
    const next = { email: validateEmail(email), password: password ? null : 'Enter your password.' };
    setErrors(next);
    setFormError(null);
    if (next.email || next.password) {
      haptic('warning');
      return;
    }
    setBusy('password');
    setMethod('password');
    try {
      await signIn(email, password);
      // The root guard swaps to the app (or onboarding) as soon as the session lands.
    } catch (error) {
      haptic('error');
      setFormError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const continueWithApple = async () => {
    setFormError(null);
    setBusy('apple');
    setMethod('apple');
    try {
      await signInWithApple();
    } catch (error) {
      haptic('error');
      setFormError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={{ gap: spacing.xl }}>
        <Wordmark size="lg" style={{ marginTop: spacing.lg }} />
        <View style={{ gap: spacing.sm }}>
          <NBText variant="display">Welcome back.</NBText>
          <NBText variant="body" color="muted">
            Your whole semester, boiled down to what matters today.
          </NBText>
        </View>

        {formError ? <ErrorBanner title="Couldn't sign in" message={formError} /> : null}

        <Card style={{ gap: spacing.lg }}>
          <TextField
            label="Email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (errors.email) setErrors((current) => ({ ...current, email: null }));
            }}
            error={errors.email}
            placeholder="you@school.edu"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (errors.password) setErrors((current) => ({ ...current, password: null }));
            }}
            error={errors.password}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            right={
              <IconButton
                icon={showPassword ? 'eye.slash' : 'eye'}
                fallback={showPassword ? '◡' : '◉'}
                label={showPassword ? 'Hide password' : 'Show password'}
                variant="ghost"
                size={36}
                onPress={() => setShowPassword((shown) => !shown)}
              />
            }
          />
          <Button
            label="Sign in"
            size="lg"
            fullWidth
            loading={working === 'password'}
            disabled={working !== null}
            onPress={() => void submit()}
          />
          <Button
            label="Forgot password?"
            variant="ghost"
            size="sm"
            style={styles.center}
            onPress={() => router.push('/forgot-password')}
          />
        </Card>

        {appleAuthAvailable ? (
          <View style={{ gap: spacing.lg }}>
            <View style={[styles.orRow, { gap: spacing.md }]}>
              <Divider style={styles.flex} />
              <NBText variant="label" color="muted">
                or
              </NBText>
              <Divider style={styles.flex} />
            </View>
            <View
              pointerEvents={working ? 'none' : 'auto'}
              accessibilityState={{ busy: working === 'apple' }}
              style={{ opacity: working ? 0.45 : 1 }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  theme.scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={radius.control}
                style={styles.apple}
                onPress={() => void continueWithApple()}
              />
            </View>
          </View>
        ) : null}

        <View style={[styles.footer, { gap: spacing.xs }]}>
          <NBText variant="body" color="muted">
            New to Termwise?
          </NBText>
          <Button label="Create an account" variant="secondary" fullWidth onPress={() => router.push('/sign-up')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignSelf: 'center' },
  orRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  apple: { width: '100%', height: 52 },
  footer: { alignItems: 'center' },
});
