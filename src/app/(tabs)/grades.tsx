import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { CourseGradeCard } from '@/components/grades/CourseGradeCard';
import { toGradeCourse } from '@/components/grades/model';
import { EmptyState, ErrorBanner, LoadingBlock, NBText, Screen } from '@/components/ui';
import { useGradebook } from '@/data/grades';
import { courseGrade } from '@/engine';
import { useTheme } from '@/theme';

export default function GradesScreen() {
  const { colors, spacing } = useTheme();
  const { view, refresh } = useGradebook();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  };

  const cards = useMemo(() => {
    if (view.status !== 'ready') return [];
    return view.courses
      .filter((row) => !row.archived)
      .map((row) => {
        const course = toGradeCourse(row);
        return { course, grade: courseGrade(course, view.components, view.items) };
      });
  }, [view]);

  const anyScores = cards.some(({ grade }) => grade.percent !== null);

  return (
    <Screen
      title="Grades"
      subtitle="Where you stand, and what you need on what's left."
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
    >
      {view.status === 'loading' ? (
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading your grades" lines={4} height={180} />
          <LoadingBlock label="Loading your grades" lines={4} height={180} />
        </View>
      ) : view.status === 'error' ? (
        <ErrorBanner title="Couldn't load your grades" message={view.error.message} onRetry={view.retry} />
      ) : cards.length === 0 ? (
        <EmptyState
          tone="green"
          title="No courses yet"
          message="Add a course from a syllabus, Canvas, or by hand. Its grades show up here as scores come back."
          actionLabel="Go to Courses"
          onAction={() => router.navigate('/courses')}
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {!anyScores ? (
            <View style={{ gap: spacing.xs, paddingBottom: spacing.xs }}>
              <NBText variant="h3">Nothing graded yet</NBText>
              <NBText variant="body" color="muted">
                Scores sync in from Canvas automatically. No Canvas? Open a course and type a score in seconds — your
                grade and what you need on the final update right away.
              </NBText>
            </View>
          ) : null}
          {cards.map(({ course, grade }) => (
            <CourseGradeCard
              key={course.id}
              course={course}
              grade={grade}
              onPress={() => router.push({ pathname: '/grades/[courseId]', params: { courseId: course.id } })}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
