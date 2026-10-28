import { Alert, StyleSheet, View } from 'react-native';

import type { CloudCalendarProvider } from '@shared/api.ts';

import { Button, ErrorBanner, ListRow, NBText, SegmentedControl, Toggle, useToast } from '@/components/ui';
import { useCalendarSync, useDeleteCalendarConnection, useUpdateCalendarConnection } from '@/data';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { CalendarConnection, CalendarDelivery } from '@/types/db';

import { Fact, Panel, StatusBadge } from './common';
import { CALENDAR_PROVIDER_NAMES, connectionState, syncedLabel, syncSummary } from './format';

const TASK_NAMES: Record<CloudCalendarProvider, string> = { google: 'Google Tasks', microsoft: 'Microsoft To Do' };
const ACCOUNT_NAMES: Record<CloudCalendarProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

export interface CloudCalendarSectionProps {
  provider: CloudCalendarProvider;
  connection: CalendarConnection | null;
  connecting: boolean;
  onConnect: () => void;
}

function Connected({
  provider,
  connection,
  connecting,
  onConnect,
}: CloudCalendarSectionProps & { connection: CalendarConnection }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const sync = useCalendarSync();
  const update = useUpdateCalendarConnection();
  const remove = useDeleteCalendarConnection();
  const name = CALENDAR_PROVIDER_NAMES[provider];
  const needsReauth = connection.status === 'needs_reauth';

  const pending = update.isPending ? update.variables?.changes : undefined;
  const delivery = pending?.delivery ?? connection.delivery;
  const withBlocks = pending?.sync_plan_blocks ?? connection.sync_plan_blocks;
  const busy = sync.isPending || update.isPending;

  const runSync = () =>
    sync.mutate(connection.id, {
      onSuccess: (response) => {
        const result = response.results.find((row) => row.connection_id === connection.id);
        if (!result) {
          toast.show({ tone: 'warning', message: `${name} needs to be reconnected before it can sync.` });
          return;
        }
        toast.show(
          syncSummary({
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            externalChanges: result.external_changes,
            errors: result.errors,
          }),
        );
      },
      onError: (error) => toast.show({ tone: 'danger', title: `Couldn't sync ${name}`, message: errorMessage(error) }),
    });

  const change = (changes: { delivery?: CalendarDelivery; sync_plan_blocks?: boolean }) =>
    update.mutate(
      { id: connection.id, changes },
      {
        onSuccess: () => {
          if (!needsReauth) runSync();
        },
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't save that", message: errorMessage(error) }),
      },
    );

  const confirmDisconnect = () =>
    Alert.alert(
      `Disconnect ${name}?`,
      `Termwise stops syncing and forgets its access. The Termwise calendar stays in your ${ACCOUNT_NAMES[provider]} account until you delete it there.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () =>
            remove.mutate(connection.id, {
              onSuccess: () => toast.show({ tone: 'success', message: `${name} disconnected.` }),
              onError: (error) => toast.show({ tone: 'danger', title: "Couldn't disconnect", message: errorMessage(error) }),
            }),
        },
      ],
    );

  const options = [
    { value: 'all_day_event', label: 'Events' },
    { value: 'task', label: 'Tasks' },
  ] as const satisfies readonly { value: CalendarDelivery; label: string }[];

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <StatusBadge state={connectionState(connection.status, connection.last_error)} />
        <NBText variant="small" color="muted" style={styles.flex}>
          {syncedLabel(connection.last_synced_at, profile?.timezone)}
        </NBText>
      </View>
      {connection.account_email ? <Fact label="Account" value={connection.account_email} /> : null}
      {needsReauth ? (
        <ErrorBanner
          title={`${name} access expired`}
          message={`Reconnect so Termwise can keep your ${name} up to date.`}
          onRetry={onConnect}
          retryLabel="Reconnect"
        />
      ) : connection.last_error ? (
        <ErrorBanner tone="warning" message={connection.last_error} />
      ) : null}

      <NBText variant="label" color="muted">
        Add deadlines as
      </NBText>
      <SegmentedControl
        options={options}
        value={delivery}
        onChange={(next) => change({ delivery: next })}
        accessibilityLabel={`Add deadlines to ${name} as`}
      />
      <NBText variant="small" color="muted">
        {delivery === 'task'
          ? `Deadlines go into a “Termwise” list in ${TASK_NAMES[provider]}.`
          : `Deadlines go into a “Termwise” calendar. Move one there and Termwise asks whether to use the new date.`}
      </NBText>
      <ListRow
        title="Include study blocks"
        subtitle="Planned sessions for the next 30 days."
        right={
          <Toggle
            value={withBlocks}
            onValueChange={(value) => change({ sync_plan_blocks: value })}
            accessibilityLabel={`Include study blocks in ${name}`}
            disabled={busy}
          />
        }
      />
      <View style={[styles.row, { gap: spacing.md }]}>
        {needsReauth ? (
          <Button label="Reconnect" loading={connecting} onPress={onConnect} style={styles.flex} fullWidth />
        ) : (
          <Button
            label="Sync now"
            icon={{ name: 'arrow.triangle.2.circlepath', fallback: '↻' }}
            loading={sync.isPending}
            disabled={busy}
            onPress={runSync}
            style={styles.flex}
            fullWidth
          />
        )}
        <Button label="Disconnect" variant="secondary" loading={remove.isPending} onPress={confirmDisconnect} />
      </View>
    </View>
  );
}

/** Google Calendar / Outlook: server-side two-way sync through calendar-sync. */
export function CloudCalendarSection(props: CloudCalendarSectionProps) {
  const { provider, connection, connecting, onConnect } = props;
  const { spacing } = useTheme();
  const name = CALENDAR_PROVIDER_NAMES[provider];

  return (
    <Panel eyebrow={ACCOUNT_NAMES[provider]} title={name}>
      {connection ? (
        <Connected {...props} connection={connection} />
      ) : (
        <View style={{ gap: spacing.md }}>
          <NBText variant="body" color="muted">
            {`Sign in with ${ACCOUNT_NAMES[provider]} and Termwise keeps a “Termwise” calendar there in sync — on every device where you use ${name}.`}
          </NBText>
          <Button
            label={`Connect ${name}`}
            icon={{ name: 'link', fallback: '∞' }}
            fullWidth
            loading={connecting}
            onPress={onConnect}
          />
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
