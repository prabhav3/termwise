import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';

import { CourseSharePanel } from '@/components/courses/CourseSharePanel';
import { CourseTextbooks } from '@/components/courses/CourseTextbooks';
import { describeMeetings } from '@/components/courses/fields';
import { GradingBar } from '@/components/courses/GradingBar';
import { goBackOr, param, routes } from '@/components/courses/nav';
import { CourseItems } from '@/components/items/CourseItems';
import { useImpactMap } from '@/components/items/impact';
import { syncedLabel } from '@/components/items/time';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Icon,
  ListRow,
  LoadingBlock,
  NBText,
  Screen,
  SectionHeader,
  useToast,
} from '@/components/ui';
import {
  useComponents,
  useCourse,
  useDeleteCourse,
  useItems,
  useLmsConnections,
  useLmsCourseFor,
  useOpenDiscrepancyCount,
  useTerms,
  useTextbooks,
  useUpdateCourse,
} from '@/data';
import { useAuth } from '@/lib/auth';
import { formatShortDate, formatTimeOfDay } from '@/lib/dates';
import { errorMessage } from '@/lib/functions';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';
import type { LmsProvider } from '@/types/db';

const PROVIDER_LABEL: Record<LmsProvider, string> = { canvas: 'Canvas', moodle: 'Moodle', blackboard: 'Blackboard', ics: 'LMS feed' };

export default function CourseScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = param(params.id);
  const { spacing, colors } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);

  const course = useCourse(id);
  const items = useItems(id);
  const components = useComponents(id);
  const textbooks = useTextbooks(id);
  const terms = useTerms();
  const discrepancies = useOpenDiscrepancyCount(id ?? undefined);
  const lmsCourse = useLmsCourseFor(id);
  const lmsConnections = useLmsConnections();
  const impacts = useImpactMap();
  const update = useUpdateCourse();
  const remove = useDeleteCourse();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([course.refetch(), items.refetch(), components.refetch(), textbooks.refetch(), discrepancies.refetch(), lmsCourse.refetch()]);
    setRefreshing(false);
  };
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />;

  if (course.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading the course" height={160} />
          <LoadingBlock label="Loading the course" lines={4} />
        </View>
      </Screen>
    );
  }

  if (course.error) {
    return (
      <Screen edges={['bottom']} refreshControl={refreshControl}>
        <Stack.Screen options={{ title: '' }} />
        <ErrorBanner title="Couldn't load the course" message={errorMessage(course.error)} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  const row = course.data;
  if (!row) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          tone="yellow"
          title="Course not found"
          message="It may have been deleted on another device."
          actionLabel="Go to Courses"
          onAction={() => router.replace(routes.coursesTab())}
        />
      </Screen>
    );
  }

  const term = row.term_id ? (terms.data ?? []).find((t) => t.id === row.term_id) : undefined;
  const meetings = describeMeetings(row.meeting_days, row.meeting_start, row.meeting_end, formatTimeOfDay);
  const facts = [
    row.instructor,
    [meetings, row.location].filter(Boolean).join(' · ') || null,
    [term?.name, row.start_date && row.end_date ? `${formatShortDate(row.start_date)} – ${formatShortDate(row.end_date)}` : null]
      .filter(Boolean)
      .join(' · ') || null,
  ].filter((line): line is string => Boolean(line));
  const label = row.code ?? row.title;
  const openCount = discrepancies.data ?? 0;
  const link = lmsCourse.data ?? null;
  const connection = link ? (lmsConnections.data ?? []).find((c) => c.id === link.connection_id) : undefined;
  const linkTitle = link ? `${connection ? PROVIDER_LABEL[connection.provider] : 'LMS'} · ${link.name}` : row.canvas_course_id ? 'Linked to Canvas' : 'Not linked to Canvas';
  const linkDetail = link
    ? link.sync_enabled
      ? syncedLabel(link.last_synced_at, profile?.timezone, today)
      : 'Sync is off'
    : row.canvas_course_id
      ? 'Imported from Canvas'
      : 'Link it to pull in assignments and catch date changes';

  const toggleArchive = () =>
    update.mutate(
      { id: row.id, changes: { archived: !row.archived } },
      {
        onSuccess: () =>
          toast.show({
            tone: 'info',
            title: row.archived ? 'Course restored' : 'Course archived',
            message: row.archived ? 'It is back in your plan.' : 'It is out of your plan. Find it under archived courses.',
          }),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't change that", message: errorMessage(error) }),
      },
    );

  const confirmDelete = () => {
    const count = items.data?.length ?? 0;
    Alert.alert(
      `Delete ${label}?`,
      `This removes the course${count > 0 ? `, its ${count} item${count === 1 ? '' : 's'}` : ''}, grades and study plan. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            remove.mutate(row.id, {
              onSuccess: () => {
                toast.show({ tone: 'info', title: 'Course deleted', message: `${label} is gone from your plan.` });
                goBackOr(routes.coursesTab());
              },
              onError: (error) => toast.show({ tone: 'danger', title: "Couldn't delete it", message: errorMessage(error) }),
            }),
        },
      ],
    );
  };

  const weighted = (components.data ?? []).filter((c) => Number(c.weight) > 0);

  return (
    <Screen edges={['bottom']} refreshControl={refreshControl}>
      <Stack.Screen
        options={{
          title: row.code ?? '',
          headerRight: () => (
            <Button label="Edit" size="sm" variant="secondary" onPress={() => router.push(routes.courseEdit(row.id))} accessibilityLabel={`Edit ${label}`} />
          ),
        }}
      />

      <Card color={row.color} shadow="lg" style={{ gap: spacing.sm }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          {row.code || row.section ? (
            <NBText variant="label" color="muted" style={styles.flex}>
              {[row.code, row.section ? `Section ${row.section}` : null].filter(Boolean).join(' · ')}
            </NBText>
          ) : (
            <View style={styles.flex} />
          )}
          {row.archived ? <Badge label="Archived" tone="ink" /> : null}
          {row.shared_from_slug ? <Badge label="From a classmate" tone="ink" /> : null}
        </View>
        <NBText variant="h1" accessibilityRole="header">
          {row.title}
        </NBText>
        {facts.map((line) => (
          <NBText key={line} variant="small" color="muted">
            {line}
          </NBText>
        ))}
        <View style={[styles.actions, { gap: spacing.sm, marginTop: spacing.sm }]}>
          <Button label="Add item" size="sm" variant="secondary" icon={{ name: 'plus', fallback: '+' }} onPress={() => router.push(routes.itemNew(row.id))} />
          <Button label="Grades" size="sm" variant="secondary" icon={{ name: 'chart.bar.fill', fallback: '▮' }} onPress={() => router.push(routes.grades(row.id))} />
        </View>
      </Card>

      {openCount > 0 ? (
        <Card color="orange" shadow="sm" style={{ marginTop: spacing.lg }} onPress={() => router.push(routes.discrepancies())} accessibilityLabel={`${openCount} differences between your syllabus and the LMS. Review them.`}>
          <View style={[styles.row, { gap: spacing.md }]}>
            <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={22} />
            <View style={styles.flex}>
              <NBText variant="bodyBold">{`${openCount} difference${openCount === 1 ? '' : 's'} with ${connection ? PROVIDER_LABEL[connection.provider] : 'your LMS'}`}</NBText>
              <NBText variant="small" color="muted">
                Dates or points that don&apos;t match the syllabus. Pick which one is right.
              </NBText>
            </View>
            <Icon name="chevron.right" fallback="›" size={16} />
          </View>
        </Card>
      ) : null}

      <SectionHeader title="Deadlines" actionLabel="Add" onAction={() => router.push(routes.itemNew(row.id))} />
      {items.isPending ? (
        <LoadingBlock label="Loading deadlines" lines={3} />
      ) : items.error ? (
        <ErrorBanner title="Couldn't load deadlines" message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
      ) : (
        <CourseItems items={items.data ?? []} today={today} impacts={impacts} courseId={row.id} />
      )}

      <SectionHeader title="Grading" actionLabel="Edit" onAction={() => router.push(routes.courseEdit(row.id))} />
      {components.isPending ? (
        <LoadingBlock label="Loading the grading breakdown" lines={2} />
      ) : weighted.length > 0 ? (
        <Card shadow="sm">
          <GradingBar components={weighted} />
        </Card>
      ) : (
        <Card color="surfaceAlt" shadow="none" style={{ gap: spacing.sm }}>
          <NBText variant="bodyBold">No grading breakdown yet</NBText>
          <NBText variant="small" color="muted">
            Add the weights from the syllabus so Termwise knows which deadlines matter most.
          </NBText>
          <Button label="Add weights" size="sm" variant="secondary" onPress={() => router.push(routes.courseEdit(row.id))} style={styles.start} />
        </Card>
      )}

      <SectionHeader title="Textbooks" />
      <CourseTextbooks courseId={row.id} textbooks={textbooks.data ?? []} />

      <SectionHeader title="Connections" />
      <Card padded={false} shadow="sm">
        <ListRow
          title={linkTitle}
          subtitle={linkDetail}
          left={<Icon name="link" fallback="⛓" size={20} color={colors.ink} />}
          onPress={() => router.push(routes.canvas())}
          accessibilityHint="Opens Canvas settings"
        />
      </Card>

      <SectionHeader title="Share" />
      <CourseSharePanel course={row} />

      <SectionHeader title="Manage" />
      <View style={{ gap: spacing.md }}>
        <Button label="Edit course details" variant="secondary" fullWidth onPress={() => router.push(routes.courseEdit(row.id))} />
        <Button
          label={row.archived ? 'Restore course' : 'Archive course'}
          variant="secondary"
          fullWidth
          loading={update.isPending}
          onPress={toggleArchive}
          accessibilityHint={row.archived ? 'Puts it back in your plan' : 'Hides it from your plan without deleting anything'}
        />
        <Button label="Delete course" variant="danger" fullWidth loading={remove.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  start: { alignSelf: 'flex-start' },
});
