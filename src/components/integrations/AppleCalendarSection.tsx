import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Card, ErrorBanner, ListRow, LoadingBlock, NBText, SegmentedControl, Toggle, useToast } from '@/components/ui';
import { useUpdateCalendarConnection } from '@/data';
import { useAuth } from '@/lib/auth';
import {
  deliveryKind,
  isAppleCalendarSupported,
  permissionFor,
  useAppleConnection,
  useApplePermissions,
  useConnectAppleCalendar,
  useDisconnectAppleCalendar,
  useRequestApplePermission,
  useSyncAppleCalendar,
  type AppleSyncResult,
} from '@/lib/calendar/apple';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { CalendarConnection, CalendarDelivery } from '@/types/db';

import { Fact, Panel, StatusBadge } from './common';
import { connectionState, plural, syncedLabel, syncSummary } from './format';

const DELIVERY_OPTIONS = [
  { value: 'all_day_event', label: 'Calendar' },
  { value: 'task', label: 'Reminders' },
] as const satisfies readonly { value: CalendarDelivery; label: string }[];

function useSyncToast() {
  const toast = useToast();
  return (result: AppleSyncResult) =>
    toast.show(
      syncSummary({
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        externalChanges: result.externalChanges,
        errors: result.errors,
      }),
    );
}

function PermissionOff({ delivery }: { delivery: CalendarDelivery }) {
  const { spacing } = useTheme();
  const what = delivery === 'task' ? 'Reminders' : 'Calendars';
  return (
    <Card color="orange" shadow="sm" style={{ gap: spacing.sm }}>
      <NBText variant="bodyBold">{`${what} access is off for Termwise.`}</NBText>
      <NBText variant="small">
        {delivery === 'task'
          ? 'Turn on Reminders for Termwise in iOS Settings so your deadlines can appear there.'
          : 'Choose "Full Access" under Calendars for Termwise in iOS Settings. Termwise reads its own events back so it notices when you move one.'}
      </NBText>
      <Button label="Open iOS Settings" variant="secondary" size="sm" onPress={() => void Linking.openSettings()} />
    </Card>
  );
}

function ConnectApple() {
  const { spacing } = useTheme();
  const toast = useToast();
  const showResult = useSyncToast();
  const connect = useConnectAppleCalendar();
  const permissions = useApplePermissions();
  const [delivery, setDelivery] = useState<CalendarDelivery>('all_day_event');
  const [withBlocks, setWithBlocks] = useState(false);
  const permission = permissions.data ? permissionFor(permissions.data, deliveryKind(delivery)) : 'undetermined';

  const start = () =>
    connect.mutate(
      { delivery, syncPlanBlocks: withBlocks },
      {
        onSuccess: showResult,
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't connect Apple Calendar", message: errorMessage(error) }),
      },
    );

  return (
    <View style={{ gap: spacing.md }}>
      <NBText variant="body" color="muted">
        Termwise adds your deadlines to a “Termwise” calendar on this iPhone. Move one in Calendar and we will ask
        whether to use the new date.
      </NBText>
      <SegmentedControl options={DELIVERY_OPTIONS} value={delivery} onChange={setDelivery} accessibilityLabel="Add deadlines to" />
      <ListRow
        title="Include study blocks"
        subtitle="Your planned sessions for the next 30 days, as all-day entries."
        right={<Toggle value={withBlocks} onValueChange={setWithBlocks} accessibilityLabel="Include study blocks" />}
      />
      {permission === 'denied' ? <PermissionOff delivery={delivery} /> : null}
      <Button
        label={delivery === 'task' ? 'Add to Reminders' : 'Add to Apple Calendar'}
        icon={{ name: 'calendar.badge.plus', fallback: '+' }}
        fullWidth
        loading={connect.isPending}
        disabled={permission === 'denied'}
        onPress={start}
      />
    </View>
  );
}

function ConnectedApple({ connection, otherDevices }: { connection: CalendarConnection; otherDevices: number }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const showResult = useSyncToast();
  const permissions = useApplePermissions();
  const sync = useSyncAppleCalendar();
  const update = useUpdateCalendarConnection();
  const request = useRequestApplePermission();
  const disconnect = useDisconnectAppleCalendar();
  const timeZone = useAuth().profile?.timezone;

  // Optimistic: show the choice being saved until the row comes back.
  const pending = update.isPending ? update.variables?.changes : undefined;
  const delivery = pending?.delivery ?? connection.delivery;
  const withBlocks = pending?.sync_plan_blocks ?? connection.sync_plan_blocks;
  const permission = permissions.data ? permissionFor(permissions.data, deliveryKind(delivery)) : 'granted';
  const busy = sync.isPending || update.isPending || request.isPending;

  const runSync = () =>
    sync.mutate(connection.id, {
      onSuccess: showResult,
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't sync", message: errorMessage(error) }),
    });

  const change = (changes: { delivery?: CalendarDelivery; sync_plan_blocks?: boolean }) =>
    update.mutate(
      { id: connection.id, changes },
      {
        onSuccess: runSync,
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't save that", message: errorMessage(error) }),
      },
    );

  const changeDelivery = (next: CalendarDelivery) => {
    request.mutate(deliveryKind(next), {
      onSuccess: (answer) => {
        if (answer === 'granted') change({ delivery: next });
        else
          toast.show({
            tone: 'warning',
            title: next === 'task' ? 'Reminders access is off' : 'Calendar access is off',
            message: 'Turn it on for Termwise in iOS Settings, then try again.',
          });
      },
    });
  };

  const confirmDisconnect = () =>
    Alert.alert('Stop syncing this iPhone?', 'Termwise stops updating Apple Calendar on this iPhone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Keep what was added',
        onPress: () => disconnect.mutate({ connection, removeFromDevice: false }),
      },
      {
        text: 'Remove Termwise calendar',
        style: 'destructive',
        onPress: () =>
          disconnect.mutate(
            { connection, removeFromDevice: true },
            {
              onSuccess: () => toast.show({ tone: 'success', message: 'Removed the Termwise calendar from this iPhone.' }),
              onError: (error) => toast.show({ tone: 'danger', title: "Couldn't disconnect", message: errorMessage(error) }),
            },
          ),
      },
    ]);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <StatusBadge state={connectionState(connection.status, connection.last_error)} />
        <NBText variant="small" color="muted" style={styles.flex}>
          {syncedLabel(connection.last_synced_at, timeZone)}
        </NBText>
      </View>
      {connection.last_error ? <ErrorBanner tone="warning" message={connection.last_error} /> : null}
      {permission === 'denied' ? <PermissionOff delivery={delivery} /> : null}
      {otherDevices > 0 ? (
        <Fact label="Also on" value={`${plural(otherDevices, 'other device')} (each syncs on its own)`} />
      ) : null}

      <NBText variant="label" color="muted">
        Add deadlines to
      </NBText>
      <SegmentedControl options={DELIVERY_OPTIONS} value={delivery} onChange={changeDelivery} accessibilityLabel="Add deadlines to" />
      <ListRow
        title="Include study blocks"
        subtitle="Planned sessions for the next 30 days."
        right={
          <Toggle
            value={withBlocks}
            onValueChange={(value) => change({ sync_plan_blocks: value })}
            accessibilityLabel="Include study blocks"
            disabled={busy}
          />
        }
      />
      <View style={[styles.row, { gap: spacing.md }]}>
        <Button
          label="Sync now"
          icon={{ name: 'arrow.triangle.2.circlepath', fallback: '↻' }}
          loading={sync.isPending}
          disabled={busy || permission === 'denied'}
          onPress={runSync}
          style={styles.flex}
          fullWidth
        />
        <Button label="Disconnect" variant="secondary" loading={disconnect.isPending} onPress={confirmDisconnect} />
      </View>
    </View>
  );
}

/** Apple Calendar / Reminders on this iPhone (EventKit, on-device two-way sync). */
export function AppleCalendarSection() {
  const { connection, otherDevices, isLoading, error, refetch } = useAppleConnection();

  if (!isAppleCalendarSupported) {
    return (
      <Panel eyebrow="On this device" title="Apple Calendar">
        <NBText variant="body" color="muted">
          Apple Calendar and Reminders sync from the Termwise iPhone app. On this device, use the iCal subscription
          link below instead.
        </NBText>
      </Panel>
    );
  }

  return (
    <Panel eyebrow="On this iPhone" title="Apple Calendar">
      {isLoading ? (
        <LoadingBlock lines={2} height={72} label="Checking Apple Calendar" />
      ) : error ? (
        <ErrorBanner message={errorMessage(error)} onRetry={refetch} />
      ) : connection ? (
        <ConnectedApple connection={connection} otherDevices={otherDevices} />
      ) : (
        <ConnectApple />
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
