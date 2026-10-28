import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import type { LmsSyncResponse } from '@shared/api.ts';

import {
  Button,
  Card,
  Chip,
  ErrorBanner,
  LoadingBlock,
  NBText,
  SegmentedControl,
  TextField,
  useToast,
} from '@/components/ui';
import { useCourses, useDeleteLmsConnection, useLmsConnect, useLmsCourses, useLmsSync } from '@/data';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Course, LmsConnection, LmsCourse } from '@/types/db';

import { Fact, Panel, StatusBadge, Steps } from './common';
import { connectionState, LMS_PROVIDER_NAMES, plural, syncedLabel } from './format';

export type FeedProvider = 'blackboard' | 'moodle' | 'ics';

const PROVIDER_OPTIONS = [
  { value: 'blackboard', label: 'Blackboard' },
  { value: 'moodle', label: 'Moodle' },
  { value: 'ics', label: 'Other' },
] as const satisfies readonly { value: FeedProvider; label: string }[];

const HELP: Record<FeedProvider, { title: string; steps: readonly string[] }> = {
  blackboard: {
    title: 'Find your Blackboard calendar link',
    steps: [
      'Sign in to Blackboard in a browser and open Calendar.',
      'Open the calendar settings (the gear) and choose “Share Calendar” or “Get External Calendar Link”.',
      'Copy the link and paste it below.',
    ],
  },
  moodle: {
    title: 'Find your Moodle calendar link',
    steps: [
      'Sign in to Moodle in a browser and open Calendar.',
      'Choose “Import or export calendars”, then “Export calendar”.',
      'Pick “All courses” and “Recent and next 60 days”, then tap “Get calendar URL”.',
      'Copy the link and paste it below.',
    ],
  },
  ics: {
    title: 'Find your LMS calendar link',
    steps: [
      'Open the calendar in your LMS (Brightspace, Schoology, Sakai and most others have one).',
      'Look for “Subscribe”, “iCal feed” or “Export”.',
      'Copy the link — it starts with https:// or webcal:// — and paste it below.',
    ],
  },
};

function syncMessage(result: LmsSyncResponse): string {
  const unmapped =
    result.unmapped_feed_courses.length > 0
      ? ` ${plural(result.unmapped_feed_courses.length, 'feed course')} still need a match.`
      : '';
  return `${plural(result.events, 'event')} read · ${plural(result.matched, 'item')} matched · ${plural(
    result.discrepancies_open,
    'difference',
  )} open.${unmapped}`;
}

// ---- connect ---------------------------------------------------------------------------------

export function LmsConnectForm({ onConnected }: { onConnected: (connectionId: string) => void }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const connect = useLmsConnect();
  const sync = useLmsSync();
  const [provider, setProvider] = useState<FeedProvider>('blackboard');
  const [feedUrl, setFeedUrl] = useState('');
  const [name, setName] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const help = HELP[provider];

  const submit = async () => {
    const url = feedUrl.trim();
    if (!/^(https?|webcals?):\/\/\S+$/i.test(url)) {
      setUrlError('Paste the whole calendar link, starting with https:// or webcal://.');
      return;
    }
    try {
      const response = await connect.mutateAsync({
        provider,
        feed_url: url,
        display_name: name.trim() || undefined,
      });
      setFeedUrl('');
      setName('');
      onConnected(response.connection_id);
      // First check right away, using the matches the server suggested.
      const result = await sync.mutateAsync({ connection_id: response.connection_id });
      toast.show({ tone: 'success', title: 'Calendar feed connected', message: syncMessage(result) });
    } catch (error) {
      toast.show({ tone: 'danger', title: "Couldn't use that feed", message: errorMessage(error) });
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <SegmentedControl options={PROVIDER_OPTIONS} value={provider} onChange={setProvider} accessibilityLabel="Your LMS" />
      <Panel title={help.title}>
        <Steps steps={help.steps} />
        <NBText variant="small" color="muted">
          Feeds carry dates only, so Termwise uses them to double-check your syllabus — never to change weights.
        </NBText>
      </Panel>
      <Panel title="Connect the feed">
        <TextField
          label="Calendar link"
          placeholder="https://…"
          value={feedUrl}
          onChangeText={(text) => {
            setFeedUrl(text);
            setUrlError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          error={urlError}
          helper="Stored encrypted on Termwise’s server. It works like a password, so don’t share it."
        />
        {provider === 'ics' ? (
          <TextField
            label="Name (optional)"
            placeholder="e.g. Brightspace"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
        ) : null}
        <Button
          label={`Connect ${provider === 'ics' ? 'feed' : LMS_PROVIDER_NAMES[provider]}`}
          fullWidth
          loading={connect.isPending || sync.isPending}
          onPress={() => void submit()}
        />
      </Panel>
    </View>
  );
}

// ---- one feed --------------------------------------------------------------------------------

function MappingRow({
  feedCourse,
  courses,
  value,
  onChange,
}: {
  feedCourse: LmsCourse;
  courses: readonly Course[];
  value: string | null;
  onChange: (courseId: string) => void;
}) {
  const { colors, spacing, borders } = useTheme();
  return (
    <View
      style={{ gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: borders.hairline, borderTopColor: colors.border }}
      accessibilityLabel={`Feed course ${feedCourse.name}`}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="bodyBold" style={styles.flex} numberOfLines={2}>
          {feedCourse.name}
        </NBText>
        <NBText variant="label" color={value ? 'muted' : 'danger'}>
          {value ? 'Matched' : '! Pick a course'}
        </NBText>
      </View>
      <View style={[styles.wrap, { gap: spacing.sm }]}>
        {courses.map((course) => (
          <Chip
            key={course.id}
            role="radio"
            label={course.code ?? course.title}
            accessibilityLabel={`Match ${feedCourse.name} to ${course.title}`}
            selected={value === course.id}
            onPress={() => onChange(course.id)}
          />
        ))}
      </View>
    </View>
  );
}

export function LmsFeedCard({ connection }: { connection: LmsConnection }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const feedCourses = useLmsCourses(connection.id);
  const courses = useCourses();
  const sync = useLmsSync();
  const remove = useDeleteLmsConnection();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<LmsSyncResponse | null>(null);

  const name = connection.display_name ?? LMS_PROVIDER_NAMES[connection.provider];
  const rows = feedCourses.data ?? [];
  const valueFor = (row: LmsCourse) => (row.external_id in overrides ? overrides[row.external_id] : row.linked_course_id);
  const changed = Object.keys(overrides).length > 0;

  const runSync = () => {
    sync.mutate(
      { connection_id: connection.id, course_map: changed ? overrides : undefined },
      {
        onSuccess: (result) => {
          setOverrides({});
          setLastResult(result);
          toast.show({ tone: 'success', title: `${name} checked`, message: syncMessage(result) });
        },
        onError: (error) => toast.show({ tone: 'danger', title: `Couldn't check ${name}`, message: errorMessage(error) }),
      },
    );
  };

  const confirmRemove = () =>
    Alert.alert(`Remove ${name}?`, 'Termwise forgets this feed and its differences. Your courses and items stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove.mutate(connection.id, {
            onSuccess: () => toast.show({ tone: 'success', message: `${name} removed.` }),
            onError: (error) => toast.show({ tone: 'danger', title: "Couldn't remove it", message: errorMessage(error) }),
          }),
      },
    ]);

  return (
    <Panel eyebrow={LMS_PROVIDER_NAMES[connection.provider]} title={name}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <StatusBadge state={connectionState(connection.status, connection.last_error)} />
        <NBText variant="small" color="muted" style={styles.flex}>
          {syncedLabel(connection.last_synced_at, profile?.timezone)}
        </NBText>
      </View>
      <Fact label="Feed from" value={connection.base_url.replace(/^https?:\/\//, '')} />
      {connection.last_error ? <ErrorBanner tone="warning" message={connection.last_error} /> : null}

      {lastResult ? (
        <Card color="surfaceAlt" shadow="none" style={{ gap: spacing.xs }}>
          <NBText variant="bodyBold">Last check</NBText>
          <NBText variant="small">{syncMessage(lastResult)}</NBText>
          {lastResult.discrepancies_open > 0 ? (
            <Button label="Review differences" variant="secondary" size="sm" onPress={() => router.push('/discrepancies')} />
          ) : null}
        </Card>
      ) : null}

      <NBText variant="label" color="muted">
        Courses in this feed
      </NBText>
      {feedCourses.isPending || courses.isPending ? (
        <LoadingBlock lines={2} height={64} label="Loading feed courses" />
      ) : feedCourses.error ? (
        <ErrorBanner message={errorMessage(feedCourses.error)} onRetry={() => void feedCourses.refetch()} />
      ) : rows.length === 0 ? (
        <NBText variant="small" color="muted">
          No courses found in this feed yet. Check it again after your LMS posts assignments.
        </NBText>
      ) : (
        <View>
          {rows.map((row) => (
            <MappingRow
              key={row.id}
              feedCourse={row}
              courses={courses.data ?? []}
              value={valueFor(row)}
              onChange={(courseId) => setOverrides((current) => ({ ...current, [row.external_id]: courseId }))}
            />
          ))}
        </View>
      )}

      <View style={[styles.row, { gap: spacing.md }]}>
        <Button
          label={changed ? 'Save matches & check' : 'Check now'}
          icon={{ name: 'arrow.triangle.2.circlepath', fallback: '↻' }}
          loading={sync.isPending}
          onPress={runSync}
          style={styles.flex}
          fullWidth
        />
        <Button label="Remove" variant="secondary" loading={remove.isPending} onPress={confirmRemove} />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
