import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ListRow, NBText, Screen, SectionHeader, SegmentedControl, type SegmentOption } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { useTheme, useThemeMode, type ThemeMode } from '@/theme';

const APPEARANCE: readonly SegmentOption<ThemeMode>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const { mode, setMode } = useThemeMode();
  const { spacing } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (problem) {
      setError(errorMessage(problem));
      setSigningOut(false);
    }
  };

  return (
    <Screen title="Settings">
      <SectionHeader title="Appearance" style={{ marginTop: 0 }} />
      <SegmentedControl options={APPEARANCE} value={mode} onChange={setMode} accessibilityLabel="Appearance" />

      <SectionHeader title="Account" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow title={profile?.display_name ?? 'Student'} subtitle={user?.email ?? undefined} />
        <ListRow divider title="Time zone" right={<NBText variant="small" color="muted">{profile?.timezone ?? '—'}</NBText>} />
      </Card>

      <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
        {error ? (
          <NBText variant="smallBold" color="red" accessibilityRole="alert">
            {`⚠ ${error}`}
          </NBText>
        ) : null}
        <Button label="Sign out" variant="secondary" fullWidth loading={signingOut} onPress={() => void handleSignOut()} />
      </View>
    </Screen>
  );
}
