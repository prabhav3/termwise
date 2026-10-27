import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View, type TextInputInstance } from 'react-native';

import { Button, Card, ErrorBanner, IconButton, NBText, Screen, TextField } from '@/components/ui';
import { MIN_PASSWORD_LENGTH, useAuth, validateDisplayName, validateEmail, validateNewPassword } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

type Field = 'name' | 'email' | 'password';

export default function SignUpScreen() {
  const { signUp, status } = useAuth();
  const { spacing } = useTheme();
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  const clearError = (field: Field) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: null }));
  };

  const submit = async () => {
    const next = {
      name: validateDisplayName(name),
      email: validateEmail(email),
      password: validateNewPassword(password),
    };
    setErrors(next);
    setFormError(null);
    if (next.name || next.email || next.password) {
      haptic('warning');
      return;
    }
    setSubmitting(true);
    try {
      const { needsConfirmation } = await signUp({ email, password, displayName: name });
      if (needsConfirmation) {
        haptic('success');
        setConfirmEmailFor(email.trim());
      }
      // Otherwise the session is live and the root guard moves on to onboarding.
    } catch (error) {
      haptic('error');
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmEmailFor) {
    return (
      <Screen scroll={false} contentContainerStyle={{ justifyContent: 'center', gap: spacing.xl }}>
        <Card color="green" shadow="lg" style={{ gap: spacing.md }}>
          <NBText variant="h1">Check your inbox.</NBText>
          <NBText variant="body">
            {`We sent a confirmation link to ${confirmEmailFor}. Tap it, then come back and sign in.`}
          </NBText>
        </Card>
        <Button label="Back to sign in" size="lg" fullWidth onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: spacing.xl }}>
        <IconButton icon="chevron.left" fallback="‹" label="Back to sign in" onPress={() => router.back()} />
        <View style={{ gap: spacing.sm }}>
          <NBText variant="display">{"Let's get you set up."}</NBText>
          <NBText variant="body" color="muted">
            Drop in your syllabi and Termwise turns them into a calm, day-by-day plan.
          </NBText>
        </View>

        {formError ? <ErrorBanner title="Couldn't create your account" message={formError} /> : null}

        <Card style={{ gap: spacing.lg }}>
          <TextField
            label="What should we call you?"
            value={name}
            onChangeText={(value) => {
              setName(value);
              clearError('name');
            }}
            error={errors.name}
            placeholder="First name is fine"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="givenName"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <TextField
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              clearError('email');
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
              clearError('password');
            }}
            error={errors.password}
            helper={`At least ${MIN_PASSWORD_LENGTH} characters, with a number.`}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
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
            label="Create account"
            size="lg"
            fullWidth
            // Stays busy while the new account's profile loads and the guard moves on to onboarding.
            loading={submitting || status === 'signedIn'}
            onPress={() => void submit()}
          />
        </Card>

        <Button
          label="I already have an account"
          variant="ghost"
          style={{ alignSelf: 'center' }}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}
