// "You moved this to Nov 3 in Google Calendar" — the student decides which date wins.
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, NBText } from '@/components/ui';
import { formatDayDate, formatTimeOfDay } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { CalendarProvider, ExternalChange } from '@/types/db';

const PROVIDER_NAME: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook',
  apple: 'Apple Calendar',
};

export function externalChangeMessage(change: ExternalChange): string {
  const where = PROVIDER_NAME[change.provider];
  if (change.deleted) return `You deleted this from ${where}.`;
  if (!change.new_due_date) return `You removed the date in ${where}.`;
  const time = change.new_due_time ? `, ${formatTimeOfDay(change.new_due_time)}` : '';
  return `You moved this to ${formatDayDate(change.new_due_date)}${time} in ${where}.`;
}

export interface ExternalChangeBannerProps {
  change: ExternalChange;
  onAccept: () => void;
  onKeep: () => void;
  busy: 'accept' | 'keep' | null;
}

export function ExternalChangeBanner({ change, onAccept, onKeep, busy }: ExternalChangeBannerProps) {
  const { spacing } = useTheme();
  const message = externalChangeMessage(change);
  return (
    <Card color="blue" shadow="md" style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]} accessible accessibilityRole="alert" accessibilityLabel={`${message} Use the new date, or keep the Termwise date?`}>
        <Icon name="calendar.badge.exclamationmark" fallback="▦" size={24} />
        <View style={styles.flex}>
          <NBText variant="bodyBold">{message}</NBText>
          <NBText variant="small" color="muted">
            {change.deleted ? 'Done with it, or should it stay in your plan?' : 'Which date should Termwise plan around?'}
          </NBText>
        </View>
      </View>
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          label={change.deleted ? 'Mark done' : 'Use the new date'}
          size="sm"
          loading={busy === 'accept'}
          disabled={busy !== null}
          onPress={onAccept}
        />
        <Button
          label={change.deleted ? 'Keep it' : 'Keep mine'}
          size="sm"
          variant="secondary"
          loading={busy === 'keep'}
          disabled={busy !== null}
          onPress={onKeep}
          accessibilityHint="Keeps the Termwise date and puts it back in your calendar on the next sync"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, gap: 2 },
});
