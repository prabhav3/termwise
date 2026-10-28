import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { GradeOverview } from '@/components/grades/GradeOverview';
import { checkWeights, formatWeight, openWeightedItems, toGradeCourse } from '@/components/grades/model';
import { ScenarioSimulator } from '@/components/grades/ScenarioSimulator';
import { ScoresPanel } from '@/components/grades/ScoresPanel';
import { WhatDoINeed } from '@/components/grades/WhatDoINeed';
import { Card, EmptyState, ErrorBanner, LoadingBlock, Screen, SegmentedControl } from '@/components/ui';
import { useGradebook } from '@/data/grades';
import { courseGrade } from '@/engine';
import { useAuth } from '@/lib/auth';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';

type Panel = 'scores' | 'need' | 'whatif';

const PANELS = [
  { value: 'scores', label: 'Scores' },
  { value: 'need', label: 'What I need' },
  { value: 'whatif', label: 'What if' },
] as const;

export default function CourseGradesScreen() {
  const params = useLocalSearchParams<{ courseId: string }>();
  const courseId = Array.isArray(params.courseId) ? params.courseId[0] : params.courseId;
  const { colors, spacing } = useTheme();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const { view, refresh } = useGradebook();
  const [panel, setPanel] = useState<Panel>('scores');
  const [refreshing, setRefreshing] = useState(false);

  const data = useMemo(() => {
    if (view.status !== 'ready') return null;
    const row = view.courses.find((course) => course.id === courseId);
    if (!row) return null;
    const course = toGradeCourse(row);
    const components = view.components.filter((component) => component.course_id === row.id);
    const items = view.items.filter((item) => item.course_id === row.id);
    const grade = courseGrade(course, components, items);
    return { course, components, items, grade, candidates: openWeightedItems(row.id, components, items) };
  }, [view, courseId]);

  const onRefresh = () => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  };

  const editWeights = () => {
    // course/edit belongs to the courses screens; typed routes may not list it yet.
    const path: string = `/course/edit?id=${encodeURIComponent(courseId ?? '')}`;
    router.push(path as Href);
  };

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />;

  if (view.status === 'loading') {
    return (
      <Screen eyebrow="Grade tracker">
        <Stack.Screen options={{ title: 'Grades' }} />
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading your grades" lines={4} height={200} />
          <LoadingBlock label="Loading your grades" lines={3} height={140} />
        </View>
      </Screen>
    );
  }

  if (view.status === 'error') {
    return (
      <Screen eyebrow="Grade tracker" refreshControl={refreshControl}>
        <Stack.Screen options={{ title: 'Grades' }} />
        <ErrorBanner title="Couldn't load your grades" message={view.error.message} onRetry={view.retry} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Grades' }} />
        <EmptyState
          tone="pink"
          title="Course not found"
          message="It may have been deleted. Your other courses are on the Grades tab."
          actionLabel="Back to Grades"
          onAction={() => (router.canGoBack() ? router.back() : router.navigate('/grades'))}
        />
      </Screen>
    );
  }

  const { course, components, items, grade, candidates } = data;
  const weights = checkWeights(grade);

  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack.Screen options={{ title: course.code ?? course.title }} />
      <Screen
        eyebrow={course.code ? `Grade tracker · ${course.code}` : 'Grade tracker'}
        title={course.title}
        refreshControl={refreshControl}
      >
        <View style={{ gap: spacing.lg }}>
          <Card>
            <GradeOverview course={course} grade={grade} size="hero" />
          </Card>

          {weights.kind === 'none' ? (
            <ErrorBanner
              tone="warning"
              title="No grading weights yet"
              message="Add the syllabus breakdown (like Exams 50%, Homework 30%) so your grade and what you need are exact."
              onRetry={editWeights}
              retryLabel="Add weights"
            />
          ) : weights.kind !== 'ok' ? (
            <ErrorBanner
              tone="warning"
              title={`Weights add up to ${formatWeight(weights.total)}, not 100%`}
              message="Your grade is scaled to what's listed, so it may be off. Check the syllabus and fix the weights."
              onRetry={editWeights}
              retryLabel="Edit weights"
            />
          ) : null}

          <SegmentedControl<Panel>
            options={PANELS}
            value={panel}
            onChange={setPanel}
            accessibilityLabel="Grade tools"
          />

          {/* All three stay mounted so a what-if survives switching tabs. */}
          <View style={panel === 'scores' ? null : styles.hidden}>
            <ScoresPanel
              course={course}
              components={components}
              items={items}
              grade={grade}
              today={today}
              onEditWeights={editWeights}
            />
          </View>
          <View style={panel === 'need' ? null : styles.hidden}>
            <WhatDoINeed
              course={course}
              components={components}
              items={items}
              grade={grade}
              candidates={candidates}
              today={today}
              onEditWeights={editWeights}
            />
          </View>
          <View style={panel === 'whatif' ? null : styles.hidden}>
            <ScenarioSimulator
              course={course}
              components={components}
              items={items}
              grade={grade}
              candidates={candidates}
              today={today}
            />
          </View>
        </View>
      </Screen>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: 'none' },
});
