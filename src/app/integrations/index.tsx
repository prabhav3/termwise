import { router } from 'expo-router';
import { View } from 'react-native';

import { IntegrationCard } from '@/components/integrations/common';
import {
  CALENDAR_PROVIDER_NAMES,
  connectionState,
  LMS_PROVIDER_NAMES,
  plural,
  syncedLabel,
  type ConnectionState,
} from '@/components/integrations/format';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { ErrorBanner, LoadingBlock, Screen, SectionHeader } from '@/components/ui';
import { useCalendarConnections, useLmsConnections, useLmsCourses, useOpenDiscrepancyCount } from '@/data';
import { useAuth } from '@/lib/auth';
import { isAppleCalendarSupported, useAppleCalendarAutoSync, useAppleConnection } from '@/lib/calendar/apple';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { CalendarConnection, LmsConnection } from '@/types/db';

function cloudSubtitle(connection: CalendarConnection | undefined, timeZone: string | undefined): string {
  if (!connection) return 'Two-way sync into a Termwise calendar or task list.';
  const account = connection.account_email ? `${connection.account_email} · ` : '';
  return `${account}${syncedLabel(connection.last_synced_at, timeZone)}`;
}

function cloudState(connection: CalendarConnection | undefined): ConnectionState {
  return connection ? connectionState(connection.status, connection.last_error) : connectionState(null);
}

function worstState(connections: readonly LmsConnection[]): ConnectionState {
  if (connections.length === 0) return connectionState(null);
  const broken = connections.find((connection) => connection.status === 'needs_reauth');
  if (broken) return connectionState(broken.status);
  const failing = connections.find((connection) => connection.last_error);
  return connectionState('active', failing?.last_error ?? null);
}

export default function IntegrationsScreen() {
  useAppleCalendarAutoSync();
  const { spacing } = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone;

  const calendars = useCalendarConnections();
  const apple = useAppleConnection();
  const lms = useLmsConnections();
  const lmsCourses = useLmsCourses();
  const openCount = useOpenDiscrepancyCount();

  const refreshControl = usePullToRefresh(() =>
    Promise.all([calendars.refetch(), lms.refetch(), lmsCourses.refetch(), openCount.refetch()]),
  );

  const google = calendars.data?.find((row) => row.provider === 'google');
  const outlook = calendars.data?.find((row) => row.provider === 'microsoft');
  const canvas = (lms.data ?? []).filter((row) => row.provider === 'canvas');
  const feeds = (lms.data ?? []).filter((row) => row.provider !== 'canvas');
  const linkedCanvasCourses = (lmsCourses.data ?? []).filter(
    (course) => course.linked_course_id !== null && canvas.some((connection) => connection.id === course.connection_id),
  ).length;

  const appleConnection = apple.connection;
  const appleState: ConnectionState = !isAppleCalendarSupported
    ? { label: 'iPhone only', tone: 'ink' }
    : appleConnection
      ? connectionState(appleConnection.status, appleConnection.last_error)
      : connectionState(null);
  const appleSubtitle = !isAppleCalendarSupported
    ? 'Syncs with Calendar or Reminders on your iPhone.'
    : appleConnection
      ? `${appleConnection.delivery === 'task' ? 'Reminders' : 'Calendar'} on this iPhone · ${syncedLabel(
          appleConnection.last_synced_at,
          timeZone,
        )}`
      : 'Deadlines in Calendar or Reminders on this iPhone.';

  const loadError = calendars.error ?? lms.error;
  const loading = calendars.isPending || lms.isPending;
  const open = openCount.data ?? 0;

  const openCalendar = () => router.push('/integrations/calendar');

  return (
    <Screen
      title="Connections"
      subtitle="Bring your deadlines to the calendars you already check, and keep them honest against your LMS."
      refreshControl={refreshControl}
    >
      {loadError ? (
        <ErrorBanner
          title="Couldn't load your connections"
          message={errorMessage(loadError)}
          onRetry={() => {
            void calendars.refetch();
            void lms.refetch();
          }}
        />
      ) : null}

      <SectionHeader title="Calendars" style={{ marginTop: 0 }} />
      {loading ? (
        <LoadingBlock lines={3} label="Loading calendar connections" />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <IntegrationCard
            title={CALENDAR_PROVIDER_NAMES.apple}
            subtitle={appleSubtitle}
            note={appleConnection?.last_error}
            icon="apple.logo"
            fallback="A"
            tone="pink"
            state={appleState}
            onPress={openCalendar}
          />
          <IntegrationCard
            title={CALENDAR_PROVIDER_NAMES.google}
            subtitle={cloudSubtitle(google, timeZone)}
            note={google?.status === 'active' ? google.last_error : null}
            icon="calendar"
            fallback="G"
            tone="blue"
            state={cloudState(google)}
            onPress={openCalendar}
          />
          <IntegrationCard
            title={CALENDAR_PROVIDER_NAMES.microsoft}
            subtitle={cloudSubtitle(outlook, timeZone)}
            note={outlook?.status === 'active' ? outlook.last_error : null}
            icon="envelope"
            fallback="O"
            tone="purple"
            state={cloudState(outlook)}
            onPress={openCalendar}
          />
          <IntegrationCard
            title="iCal subscription"
            subtitle="A read-only link any calendar app can subscribe to."
            icon="link"
            fallback="∞"
            tone="yellow"
            state={{ label: 'Link ready', tone: 'ink' }}
            onPress={openCalendar}
          />
        </View>
      )}

      <SectionHeader title="School systems" />
      {loading ? (
        <LoadingBlock lines={2} label="Loading school system connections" />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <IntegrationCard
            title={LMS_PROVIDER_NAMES.canvas}
            subtitle={
              canvas.length > 0
                ? `${plural(linkedCanvasCourses, 'course')} linked · ${syncedLabel(canvas[0].last_synced_at, timeZone)}`
                : 'Import assignments, weights and scores from Canvas.'
            }
            icon="graduationcap"
            fallback="C"
            tone="orange"
            state={worstState(canvas)}
            onPress={() => router.push('/integrations/canvas')}
          />
          <IntegrationCard
            title="Blackboard, Moodle & other LMS"
            subtitle={
              feeds.length > 0
                ? `${plural(feeds.length, 'calendar feed')} · ${feeds
                    .map((feed) => feed.display_name ?? LMS_PROVIDER_NAMES[feed.provider])
                    .join(', ')}`
                : 'Check your syllabus dates against your LMS calendar feed.'
            }
            icon="building.columns"
            fallback="L"
            tone="green"
            state={worstState(feeds)}
            onPress={() => router.push('/integrations/lms')}
          />
        </View>
      )}

      <SectionHeader title="Check-ups" />
      <IntegrationCard
        title="Discrepancies"
        subtitle={
          open > 0
            ? `${plural(open, 'difference')} between your syllabi and your LMS to review.`
            : 'Your syllabi and LMS agree. Nothing to review.'
        }
        icon="arrow.left.arrow.right"
        fallback="⇄"
        tone="red"
        state={open > 0 ? { label: `${open} open`, tone: 'orange' } : { label: 'All clear', tone: 'green' }}
        onPress={() => router.push('/discrepancies')}
      />
    </Screen>
  );
}
