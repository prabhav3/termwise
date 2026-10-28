import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { View } from 'react-native';

import { Button, Card, ListRow, NBText, TimeField, Toggle, useToast } from '@/components/ui';
import { formatTimeOfDay, normalizeTime } from '@/lib/dates';
import { getNotificationPermission, requestNotificationPermission } from '@/lib/notifications';
import { useTheme } from '@/theme';

import type { ProfileAutosave } from './useProfileAutosave';

const permissionKey = ['device', 'notificationPermission'] as const;

/**
 * Morning top-3 digest. Profile changes replan, and every replan reschedules the digests
 * (scheduleTriageNotifications), so saving here is all it takes.
 */
export function NotificationSettings({ settings }: { settings: ProfileAutosave }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const client = useQueryClient();
  const permission = useQuery({ queryKey: permissionKey, queryFn: getNotificationPermission, staleTime: 0 });
  const enabled = settings.value('notifications_enabled');
  const time = normalizeTime(settings.value('triage_notification_time'));
  const denied = permission.data === 'denied';
  const on = enabled && !denied;

  const toggle = async (next: boolean) => {
    if (!next) {
      settings.set('notifications_enabled', false);
      return;
    }
    const answer = await requestNotificationPermission();
    client.setQueryData(permissionKey, answer);
    if (answer === 'granted') {
      settings.set('notifications_enabled', true);
      toast.show({ tone: 'success', message: `Your top 3 will arrive at ${formatTimeOfDay(time)}.` });
    } else {
      toast.show({ tone: 'warning', title: 'Notifications are off', message: 'Turn them on for Termwise in iOS Settings.' });
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ListRow
        title="Morning top 3"
        subtitle={on ? `Every day at ${formatTimeOfDay(time)}` : 'Off'}
        right={<Toggle value={on} onValueChange={(next) => void toggle(next)} accessibilityLabel="Morning top 3 notification" />}
      />
      {denied && enabled ? (
        <Card color="orange" shadow="sm" style={{ gap: spacing.sm }}>
          <NBText variant="bodyBold">Notifications are off for Termwise.</NBText>
          <NBText variant="small">Turn them on in iOS Settings to get your morning top 3. Your plan works either way.</NBText>
          <Button label="Open iOS Settings" variant="secondary" size="sm" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
      {on ? (
        <TimeField
          label="Send it at"
          value={time}
          onChange={(next) => settings.set('triage_notification_time', next)}
        />
      ) : null}
    </View>
  );
}
