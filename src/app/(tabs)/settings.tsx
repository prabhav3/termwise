import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { DeleteAccountSheet } from '@/components/settings/DeleteAccountSheet';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { FocusTimerSettings, StudyPreferences } from '@/components/settings/StudyPreferences';
import { useProfileAutosave } from '@/components/settings/useProfileAutosave';
import {
  Badge,
  Card,
  ErrorBanner,
  Icon,
  ListRow,
  LoadingBlock,
  NBText,
  Screen,
  SectionHeader,
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui';
import { useOpenDiscrepancyCount } from '@/data';
import { useAuth } from '@/lib/auth';
import { useAppleCalendarAutoSync } from '@/lib/calendar/apple';
import { errorMessage } from '@/lib/functions';
import { useToday } from '@/lib/planner';
import { useTheme, useThemeMode, type ThemeMode } from '@/theme';
import type { Profile } from '@/types/db';

const APPEARANCE: readonly SegmentOption<ThemeMode>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { profile } = useAuth();
  if (!profile) {
    return (
      <Screen title="Settings">
        <LoadingBlock lines={6} label="Loading your settings" />
      </Screen>
    );
  }
  return <SettingsBody profile={profile} />;
}

/** "Saving…" while a change is in flight, then "Saved" (only once something was changed). */
function SaveStatus({ saving }: { saving: boolean }) {
  const [changed, setChanged] = useState(false);
  if (saving && !changed) setChanged(true);
  if (!saving && !changed) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <Badge
        label={saving ? 'Saving…' : '✓ Saved'}
        tone={saving ? 'yellow' : 'green'}
        accessibilityLabel={saving ? 'Saving your changes' : 'All changes saved'}
      />
    </View>
  );
}

function SettingsBody({ profile }: { profile: Profile }) {
  // Keeps the on-device Apple Calendar in step after replans and on foreground while the app is open.
  useAppleCalendarAutoSync();
  const { spacing } = useTheme();
  const { user, signOut, refreshProfile } = useAuth();
  const { mode, setMode } = useThemeMode();
  const settings = useProfileAutosave(profile);
  const today = useToday(profile.timezone);
  const openDiscrepancies = useOpenDiscrepancyCount();
  const refreshControl = usePullToRefresh(() => Promise.all([refreshProfile(), openDiscrepancies.refetch()]));

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (problem) {
      setSignOutError(errorMessage(problem));
      setSigningOut(false);
    }
  };

  const open = openDiscrepancies.data ?? 0;

  return (
    <Screen
      title="Settings"
      subtitle="Changes save on their own and your plan updates to match."
      headerRight={<SaveStatus saving={settings.saving} />}
      refreshControl={refreshControl}
    >
      <SectionHeader title="You" style={{ marginTop: 0 }} />
      <ProfileSection settings={settings} email={user?.email ?? null} />

      <SectionHeader title="Study plan" />
      <StudyPreferences settings={settings} today={today} />

      <SectionHeader title="Notifications" />
      <Card>
        <NotificationSettings settings={settings} />
      </Card>

      <SectionHeader title="Focus timer" />
      <FocusTimerSettings settings={settings} />

      <SectionHeader title="Appearance" />
      <SegmentedControl options={APPEARANCE} value={mode} onChange={setMode} accessibilityLabel="Appearance" />

      <SectionHeader title="Connections" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow
          title="Calendars & school systems"
          subtitle="Apple, Google, Outlook, iCal, Canvas, Blackboard, Moodle"
          left={<Icon name="link" fallback="∞" size={20} />}
          chevron
          onPress={() => router.push('/integrations')}
        />
        <ListRow
          divider
          title="Discrepancies"
          subtitle={open > 0 ? 'Syllabus and LMS dates that disagree' : 'Your syllabi and LMS agree'}
          left={<Icon name="arrow.left.arrow.right" fallback="⇄" size={20} />}
          right={
            open > 0 ? (
              <Badge label={String(open)} tone="orange" accessibilityLabel={`${open} open`} />
            ) : (
              <Badge label="✓ Clear" tone="green" accessibilityLabel="None open" />
            )
          }
          chevron
          onPress={() => router.push('/discrepancies')}
        />
      </Card>

      <SectionHeader title="Account" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <ListRow
          title={signingOut ? 'Signing out…' : 'Sign out'}
          subtitle={user?.email ?? undefined}
          left={<Icon name="rectangle.portrait.and.arrow.right" fallback="⇥" size={20} />}
          onPress={signingOut ? undefined : () => void handleSignOut()}
          accessibilityHint="Signs you out on this iPhone"
        />
        <ListRow
          divider
          destructive
          title="Delete account"
          subtitle="Permanently removes your courses, plan and files"
          left={<Icon name="trash" fallback="✕" size={20} />}
          onPress={() => setDeleteOpen(true)}
          accessibilityHint="Asks you to confirm twice"
        />
      </Card>
      {signOutError ? (
        <ErrorBanner title="Couldn't sign out" message={signOutError} style={{ marginTop: spacing.md }} />
      ) : null}

      <NBText variant="tiny" color="muted" align="center" style={{ marginTop: spacing.xl }}>
        Termwise plans your semester from your syllabi.
      </NBText>

      <DeleteAccountSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </Screen>
  );
}
