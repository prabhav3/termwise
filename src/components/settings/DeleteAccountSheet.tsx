import { useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorBanner, NBText, Sheet, TextField, useToast } from '@/components/ui';
import { useDeleteAccount } from '@/data/profile';
import { APPLE_SETTINGS_PATH, appleAccessMayRemain, usesAppleSignIn } from '@/lib/apple-identity';
import { useAuth } from '@/lib/auth';
import { errorMessage, isAppError, type DeleteAccountOptions } from '@/lib/functions';
import { useTheme } from '@/theme';

const CONFIRM_WORD = 'DELETE';

const WHAT_GOES = [
  'Every course, deadline, reading and grade',
  'Your uploaded syllabi and photos',
  'Calendar, Canvas and LMS connections, and share links you made',
] as const;

type Step = 'explain' | 'confirm' | 'apple';

const TITLES: Record<Step, string> = {
  explain: 'Delete your account?',
  confirm: 'Last check',
  apple: 'Confirm with Apple',
};

/**
 * Two confirmations: read what is deleted, then type DELETE. The account function removes files
 * and the auth user; the session ends and the guard returns to sign-in.
 *
 * Sign in with Apple accounts confirm with Apple first: the fresh authorizationCode lets the server
 * revoke Termwise's Apple tokens (Apple's account-deletion rule) even when none was stored at
 * sign-in. If the student cancels the Apple sheet (or the server asks for it with
 * `apple_reauth_required`), the 'apple' step explains and lets them retry, delete anyway, or stop.
 */
export function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { spacing } = useTheme();
  const auth = useAuth();
  const toast = useToast();
  const remove = useDeleteAccount();
  const [step, setStep] = useState<Step>('explain');
  const [typed, setTyped] = useState('');
  const [askingApple, setAskingApple] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);

  const appleUser = usesAppleSignIn(auth.user);
  const canAskApple = auth.appleAuthAvailable;
  const busy = remove.isPending || askingApple;

  const close = () => {
    if (busy) return;
    setStep('explain');
    setTyped('');
    setAppleError(null);
    remove.reset();
    onClose();
  };

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const deleteNow = async (options: DeleteAccountOptions) => {
    try {
      const result = await remove.mutateAsync(options);
      if (appleAccessMayRemain(result.apple_revocation, appleUser)) {
        toast.show({
          title: 'Account deleted',
          message: `Termwise may still be listed under Sign in with Apple. You can remove it in ${APPLE_SETTINGS_PATH}.`,
          duration: 8000,
        });
      }
    } catch (error) {
      // Nothing was deleted: the account has no stored Apple token, so confirm with Apple first.
      if (isAppError(error) && error.code === 'apple_reauth_required') {
        remove.reset();
        setStep('apple');
      }
      // Anything else shows in the ErrorBanner (remove.error).
    }
  };

  const confirmWithApple = async () => {
    setAppleError(null);
    remove.reset();
    setAskingApple(true);
    let code: string;
    try {
      code = await auth.reauthorizeWithApple();
    } catch (error) {
      setAppleError(errorMessage(error));
      setStep('apple');
      return;
    } finally {
      setAskingApple(false);
    }
    if (code === 'canceled') {
      setStep('apple');
      return;
    }
    await deleteNow({ appleAuthorizationCode: code });
  };

  const startDelete = () => {
    if (appleUser && canAskApple) void confirmWithApple();
    else void deleteNow({});
  };

  const deleteError = remove.error ? (
    <ErrorBanner title="Couldn't delete your account" message={errorMessage(remove.error)} />
  ) : null;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={TITLES[step]}
      footer={
        step === 'explain' ? (
          <View style={{ gap: spacing.md }}>
            <Button label="Continue" variant="danger" fullWidth onPress={() => setStep('confirm')} />
            <Button label="Keep my account" variant="secondary" fullWidth onPress={close} />
          </View>
        ) : step === 'confirm' ? (
          <View style={{ gap: spacing.md }}>
            <Button
              label="Delete my account forever"
              variant="danger"
              fullWidth
              disabled={!confirmed}
              loading={busy}
              onPress={startDelete}
            />
            <Button label="Cancel" variant="secondary" fullWidth disabled={busy} onPress={close} />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {canAskApple ? (
              <Button
                label="Confirm with Apple"
                fullWidth
                loading={askingApple}
                disabled={remove.isPending}
                onPress={() => void confirmWithApple()}
              />
            ) : null}
            <Button
              label="Delete without Apple"
              variant="danger"
              fullWidth
              loading={remove.isPending}
              disabled={askingApple}
              onPress={() => void deleteNow({ skipAppleRevocation: true })}
            />
            <Button label="Keep my account" variant="secondary" fullWidth disabled={busy} onPress={close} />
          </View>
        )
      }
    >
      {step === 'explain' ? (
        <View style={{ gap: spacing.sm }}>
          <NBText variant="body">This permanently deletes:</NBText>
          {WHAT_GOES.map((line) => (
            <NBText key={line} variant="bodyMedium">{`• ${line}`}</NBText>
          ))}
          <NBText variant="small" color="muted">
            Events already added to Google, Outlook or Apple Calendar stay there until you delete the Termwise
            calendar in that app. This can’t be undone.
          </NBText>
        </View>
      ) : step === 'confirm' ? (
        <View style={{ gap: spacing.md }}>
          <TextField
            label={`Type ${CONFIRM_WORD} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={CONFIRM_WORD}
            returnKeyType="done"
          />
          {appleUser && canAskApple ? (
            <NBText variant="small" color="muted">
              You signed in with Apple, so Apple asks you to confirm next. That lets Termwise remove its access to your
              Apple ID too.
            </NBText>
          ) : null}
          {deleteError}
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <NBText variant="body">
            {canAskApple
              ? 'Confirming with Apple lets Termwise remove its access to your Apple ID while it deletes your account.'
              : 'Termwise needs you to confirm with Apple to remove its access to your Apple ID, and this device can’t show the Apple sheet.'}
          </NBText>
          <NBText variant="small" color="muted">
            {`If you delete without Apple, your account and data are still deleted. Termwise may then stay listed under Sign in with Apple until you remove it in ${APPLE_SETTINGS_PATH}.`}
          </NBText>
          {appleError ? <ErrorBanner title="Apple didn't confirm" message={appleError} /> : null}
          {deleteError}
        </View>
      )}
    </Sheet>
  );
}
