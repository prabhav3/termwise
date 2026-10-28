import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  CourseTag,
  EmptyState,
  ErrorBanner,
  ListRow,
  LoadingBlock,
  NBText,
  useToast,
} from '@/components/ui';
import {
  queryKeys,
  useCanvasCourses,
  useCanvasDisconnect,
  useCanvasFetchSyllabus,
  useCanvasSync,
  useCourses,
  useDiscrepancies,
  useLmsCourses,
  useStartParse,
} from '@/data';
import { useAuth } from '@/lib/auth';
import { errorMessage, isAppError } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { LmsConnection, LmsCourse } from '@/types/db';

import { CanvasConnectForm } from './CanvasConnectForm';
import { CanvasCoursePicker } from './CanvasCoursePicker';
import { Fact, Panel, StatusBadge } from './common';
import { connectionState, plural, syncedLabel } from './format';

/** Canvas rejected the token: refresh the row so the screen shows the reconnect form. */
export function useCanvasAuthGuard() {
  const client = useQueryClient();
  return (error: unknown): boolean => {
    if (isAppError(error) && error.code === 'upstream_auth') {
      void client.invalidateQueries({ queryKey: queryKeys.lmsConnections() });
      return true;
    }
    return false;
  };
}

function LinkedCourseRow({
  lmsCourse,
  connectionId,
  divider,
}: {
  lmsCourse: LmsCourse;
  connectionId: string;
  divider: boolean;
}) {
  const { spacing } = useTheme();
  const toast = useToast();
  const authGuard = useCanvasAuthGuard();
  const course = useCourses({ includeArchived: true }).data?.find((c) => c.id === lmsCourse.linked_course_id) ?? null;
  const fetchSyllabus = useCanvasFetchSyllabus();
  const startParse = useStartParse();
  const reading = fetchSyllabus.isPending || startParse.isPending;

  const readSyllabus = async () => {
    try {
      const { upload_id } = await fetchSyllabus.mutateAsync({ connectionId, externalId: lmsCourse.external_id });
      if (!upload_id) {
        toast.show({
          tone: 'info',
          title: 'No syllabus page in Canvas',
          message: 'This course has nothing on its Canvas syllabus page. Upload the PDF instead.',
        });
        return;
      }
      await startParse.mutateAsync(upload_id);
      router.push(`/review/${upload_id}`);
    } catch (error) {
      if (authGuard(error)) return;
      toast.show({ tone: 'danger', title: "Couldn't read the syllabus", message: errorMessage(error) });
    }
  };

  return (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
      <ListRow
        divider={divider}
        title={course?.title ?? lmsCourse.name}
        subtitle={[lmsCourse.course_code, lmsCourse.term_name].filter(Boolean).join(' · ') || undefined}
        left={course ? <CourseTag course={course} /> : undefined}
        onPress={course ? () => router.push(`/course/${course.id}`) : undefined}
        accessibilityHint={course ? 'Opens the course' : undefined}
      />
      {lmsCourse.has_syllabus ? (
        <Button
          label="Read Canvas syllabus with AI"
          variant="secondary"
          size="sm"
          icon={{ name: 'sparkles', fallback: '✦' }}
          loading={reading}
          onPress={() => void readSyllabus()}
          accessibilityHint="Copies the Canvas syllabus page and opens the review screen"
        />
      ) : null}
    </View>
  );
}

function AddCourses({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const courses = useCanvasCourses(connectionId);
  const authGuard = useCanvasAuthGuard();
  if (courses.isPending) return <LoadingBlock lines={4} label="Loading your Canvas courses" />;
  if (courses.error) {
    const expired = authGuard(courses.error);
    return (
      <ErrorBanner
        title={expired ? 'Canvas needs a new token' : "Couldn't load your Canvas courses"}
        message={errorMessage(courses.error)}
        onRetry={() => void courses.refetch()}
      />
    );
  }
  return <CanvasCoursePicker connectionId={connectionId} courses={courses.data} onDone={onClose} onCancel={onClose} />;
}

/** One Canvas connection: linked courses, sync, AI syllabus reading, differences, disconnect. */
export function CanvasConnection({ connection }: { connection: LmsConnection }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const authGuard = useCanvasAuthGuard();
  const lmsCourses = useLmsCourses(connection.id);
  const open = useDiscrepancies({ status: 'open' });
  const sync = useCanvasSync();
  const disconnect = useCanvasDisconnect();
  const [adding, setAdding] = useState(false);

  if (connection.status === 'needs_reauth') {
    return <CanvasConnectForm reconnect initialUrl={connection.base_url} onConnected={() => setAdding(false)} />;
  }
  if (adding) return <AddCourses connectionId={connection.id} onClose={() => setAdding(false)} />;

  const linked = (lmsCourses.data ?? []).filter((course) => course.linked_course_id !== null);
  const openHere = (open.data ?? []).filter((row) => row.connection_id === connection.id).length;
  const host = connection.base_url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const runSync = () =>
    sync.mutate(connection.id, {
      onSuccess: (result) =>
        toast.show({
          tone: 'success',
          title: 'Canvas synced',
          message: `${plural(result.synced_courses, 'course')} checked · ${plural(result.items_created, 'new item')} · ${plural(
            result.items_updated,
            'update',
          )}.`,
        }),
      onError: (error) => {
        if (authGuard(error)) return;
        toast.show({ tone: 'danger', title: "Couldn't sync Canvas", message: errorMessage(error) });
      },
    });

  const confirmDisconnect = () =>
    Alert.alert(
      'Disconnect Canvas?',
      'Termwise deletes your saved token. Courses and assignments already imported stay in your plan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () =>
            disconnect.mutate(connection.id, {
              onSuccess: () => toast.show({ tone: 'success', message: 'Canvas disconnected.' }),
              onError: (error) => toast.show({ tone: 'danger', title: "Couldn't disconnect", message: errorMessage(error) }),
            }),
        },
      ],
    );

  return (
    <View style={{ gap: spacing.lg }}>
      <Panel eyebrow="Canvas" title={connection.display_name ?? host}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <StatusBadge state={connectionState(connection.status, connection.last_error)} />
          <NBText variant="small" color="muted" style={styles.flex}>
            {syncedLabel(connection.last_synced_at, profile?.timezone)}
          </NBText>
        </View>
        <Fact label="School" value={host} />
        {connection.last_error ? <ErrorBanner tone="warning" message={connection.last_error} /> : null}
        <View style={[styles.row, { gap: spacing.md }]}>
          <Button
            label="Sync now"
            icon={{ name: 'arrow.triangle.2.circlepath', fallback: '↻' }}
            loading={sync.isPending}
            onPress={runSync}
            disabled={linked.length === 0}
            style={styles.flex}
            fullWidth
          />
          <Button label="Add courses" variant="secondary" onPress={() => setAdding(true)} />
        </View>
      </Panel>

      {openHere > 0 ? (
        <Card color="orange" onPress={() => router.push('/discrepancies')} accessibilityHint="Opens the differences" style={{ gap: spacing.xs }}>
          <NBText variant="bodyBold">{`${plural(openHere, 'difference')} to review`}</NBText>
          <NBText variant="small">Canvas and your syllabus disagree on a few things. Pick which one is right.</NBText>
        </Card>
      ) : null}

      <Panel title="Linked courses">
        {lmsCourses.isPending ? (
          <LoadingBlock lines={3} label="Loading linked courses" />
        ) : lmsCourses.error ? (
          <ErrorBanner message={errorMessage(lmsCourses.error)} onRetry={() => void lmsCourses.refetch()} />
        ) : linked.length === 0 ? (
          <EmptyState
            title="No courses yet"
            message="Pick the Canvas courses you want in your plan."
            actionLabel="Choose courses"
            onAction={() => setAdding(true)}
            tone="orange"
          />
        ) : (
          <View>
            {linked.map((course, index) => (
              <LinkedCourseRow key={course.id} lmsCourse={course} connectionId={connection.id} divider={index > 0} />
            ))}
          </View>
        )}
      </Panel>

      <Button label="Disconnect Canvas" variant="ghost" loading={disconnect.isPending} onPress={confirmDisconnect} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
