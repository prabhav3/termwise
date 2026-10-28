import { useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorBanner, NBText, Sheet, TextField } from '@/components/ui';
import { useDeleteAccount } from '@/data/profile';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

const CONFIRM_WORD = 'DELETE';

const WHAT_GOES = [
  'Every course, deadline, reading and grade',
  'Your uploaded syllabi and photos',
  'Calendar, Canvas and LMS connections, and share links you made',
] as const;

/**
 * Two confirmations: read what is deleted, then type DELETE. The account function removes files
 * and the auth user; the session ends and the guard returns to sign-in.
 */
export function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { spacing } = useTheme();
  const remove = useDeleteAccount();
  const [step, setStep] = useState<'explain' | 'confirm'>('explain');
  const [typed, setTyped] = useState('');

  const close = () => {
    if (remove.isPending) return;
    setStep('explain');
    setTyped('');
    remove.reset();
    onClose();
  };

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={step === 'explain' ? 'Delete your account?' : 'Last check'}
      footer={
        step === 'explain' ? (
          <View style={{ gap: spacing.md }}>
            <Button label="Continue" variant="danger" fullWidth onPress={() => setStep('confirm')} />
            <Button label="Keep my account" variant="secondary" fullWidth onPress={close} />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Button
              label="Delete my account forever"
              variant="danger"
              fullWidth
              disabled={!confirmed}
              loading={remove.isPending}
              onPress={() => remove.mutate()}
            />
            <Button label="Cancel" variant="secondary" fullWidth disabled={remove.isPending} onPress={close} />
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
      ) : (
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
          {remove.error ? <ErrorBanner title="Couldn't delete your account" message={errorMessage(remove.error)} /> : null}
        </View>
      )}
    </Sheet>
  );
}
