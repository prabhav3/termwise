import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { DiscrepancyCard } from '@/components/integrations/DiscrepancyCard';
import { LMS_PROVIDER_NAMES, plural } from '@/components/integrations/format';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import {
  CourseTag,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  NBText,
  Screen,
  SegmentedControl,
  useToast,
} from '@/components/ui';
import {
  useActOnDiscrepancy,
  useCourses,
  useDiscrepancies,
  useLmsConnections,
  type DiscrepancyAction,
} from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Course, LmsConnection, LmsDiscrepancy } from '@/types/db';

type Filter = 'open' | 'resolved';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
] as const satisfies readonly { value: Filter; label: string }[];

const SUCCESS: Record<DiscrepancyAction, string> = {
  use_lms: 'Date updated. Your plan is being adjusted.',
  keep_syllabus: 'Kept the syllabus version.',
  add_item: 'Added to your plan.',
  dismiss: 'Dismissed.',
  reopen: 'Moved back to open.',
};

interface Group {
  course: Course | null;
  courseId: string;
  rows: LmsDiscrepancy[];
}

function groupByCourse(rows: readonly LmsDiscrepancy[], courses: readonly Course[]): Group[] {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const group = groups.get(row.course_id) ?? { course: byId.get(row.course_id) ?? null, courseId: row.course_id, rows: [] };
    group.rows.push(row);
    groups.set(row.course_id, group);
  }
  return [...groups.values()].sort((a, b) => (a.course?.title ?? '').localeCompare(b.course?.title ?? ''));
}

function lmsNameFor(connection: LmsConnection | undefined): string {
  if (!connection) return 'LMS';
  if (connection.provider === 'ics') return connection.display_name ?? LMS_PROVIDER_NAMES.ics;
  return LMS_PROVIDER_NAMES[connection.provider];
}

export default function DiscrepanciesScreen() {
  const { spacing } = useTheme();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('open');
  const all = useDiscrepancies({ status: 'all' });
  const courses = useCourses({ includeArchived: true });
  const connections = useLmsConnections();
  const act = useActOnDiscrepancy();
  const [busy, setBusy] = useState<{ id: string; action: DiscrepancyAction } | null>(null);

  const refreshControl = usePullToRefresh(() => Promise.all([all.refetch(), courses.refetch(), connections.refetch()]));

  const rows = (all.data ?? []).filter((row) => (filter === 'open' ? row.status === 'open' : row.status !== 'open'));
  const openCount = (all.data ?? []).filter((row) => row.status === 'open').length;
  const groups = groupByCourse(rows, courses.data ?? []);
  const connectionsById = new Map((connections.data ?? []).map((connection) => [connection.id, connection]));
  const hasLms = (connections.data ?? []).length > 0;

  const onAct = (discrepancy: LmsDiscrepancy, action: DiscrepancyAction) => {
    setBusy({ id: discrepancy.id, action });
    act.mutate(
      { discrepancy, action },
      {
        onSuccess: () => toast.show({ tone: 'success', message: SUCCESS[action] }),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't update that", message: errorMessage(error) }),
        onSettled: () => setBusy(null),
      },
    );
  };

  let body: ReactNode;
  if (all.isPending || courses.isPending) {
    body = <LoadingBlock lines={4} label="Loading differences" />;
  } else if (all.error) {
    body = (
      <ErrorBanner title="Couldn't load differences" message={errorMessage(all.error)} onRetry={() => void all.refetch()} />
    );
  } else if (groups.length === 0) {
    body =
      filter === 'open' ? (
        <EmptyState
          title={hasLms ? 'All clear' : 'Nothing to compare yet'}
          message={
            hasLms
              ? 'Your syllabi and your LMS agree. We check again every time you sync.'
              : 'Connect Canvas or your LMS calendar feed and Termwise flags any date that differs from your syllabus.'
          }
          actionLabel={hasLms ? undefined : 'Connect an LMS'}
          onAction={hasLms ? undefined : () => router.push('/integrations')}
          tone="green"
        />
      ) : (
        <EmptyState title="Nothing resolved yet" message="Differences you settle show up here." tone="blue" />
      );
  } else {
    body = (
      <View style={{ gap: spacing.xl }}>
        {groups.map((group) => (
          <View key={group.courseId} style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]} accessibilityRole="header">
              {group.course ? <CourseTag course={group.course} /> : null}
              <NBText variant="h3" style={styles.flex} numberOfLines={2}>
                {group.course?.title ?? 'Removed course'}
              </NBText>
              <NBText variant="small" color="muted">
                {plural(group.rows.length, filter === 'open' ? 'open' : 'item', filter === 'open' ? 'open' : 'items')}
              </NBText>
            </View>
            {group.rows.map((row) => {
              const connection = row.connection_id ? connectionsById.get(row.connection_id) : undefined;
              return (
                <DiscrepancyCard
                  key={row.id}
                  discrepancy={row}
                  lmsName={lmsNameFor(connection)}
                  provider={connection?.provider ?? null}
                  busyAction={busy?.id === row.id ? busy.action : null}
                  onAct={(action) => onAct(row, action)}
                />
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  return (
    <Screen
      title="Differences"
      subtitle={
        openCount > 0
          ? `${plural(openCount, 'place')} where your syllabus and your LMS disagree. Pick which one is right.`
          : 'Where your syllabus and your LMS disagree.'
      }
      refreshControl={refreshControl}
    >
      <SegmentedControl
        options={FILTERS}
        value={filter}
        onChange={setFilter}
        accessibilityLabel="Show differences"
        style={{ marginBottom: spacing.xl }}
      />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
