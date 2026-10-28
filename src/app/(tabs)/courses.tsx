import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { UploadStatusCard } from '@/components/capture/UploadStatusCard';
import { AddCourseSheet, type AddCourseChoice } from '@/components/courses/AddCourseSheet';
import { CourseCard } from '@/components/courses/CourseCard';
import { routes } from '@/components/courses/nav';
import { useImpactMap } from '@/components/items/impact';
import { Button, EmptyState, ErrorBanner, IconButton, LoadingBlock, Screen, SectionHeader } from '@/components/ui';
import { useCourses, useItems, useTerms } from '@/data';
import { useActiveUploads } from '@/data/capture';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';
import type { Course, Item } from '@/types/db';

/** Lets the sheet finish dismissing before a modal route is presented on top. */
const SHEET_DISMISS_MS = 280;

interface CourseGroup {
  key: string;
  title: string;
  courses: Course[];
}

export default function CoursesScreen() {
  const { spacing, colors } = useTheme();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const courses = useCourses({ includeArchived: true });
  const terms = useTerms();
  const items = useItems();
  const uploads = useActiveUploads();
  const impacts = useImpactMap();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const upcomingByCourse = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items.data ?? []) {
      if (item.status === 'done' || item.status === 'missed' || !item.due_date || item.due_date < today) continue;
      const list = map.get(item.course_id) ?? [];
      list.push(item);
      map.set(item.course_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || (a.due_time ?? '').localeCompare(b.due_time ?? ''));
    }
    return map;
  }, [items.data, today]);

  const groups = useMemo<CourseGroup[]>(() => {
    const active = (courses.data ?? []).filter((course) => !course.archived);
    const termList = terms.data ?? [];
    const known = new Set(termList.map((term) => term.id));
    const out: CourseGroup[] = termList
      .map((term) => ({ key: term.id, title: term.name, courses: active.filter((course) => course.term_id === term.id) }))
      .filter((group) => group.courses.length > 0);
    const loose = active.filter((course) => course.term_id === null || !known.has(course.term_id));
    if (loose.length > 0) out.push({ key: 'none', title: out.length > 0 ? 'Other courses' : 'Your courses', courses: loose });
    return out;
  }, [courses.data, terms.data]);

  const archived = (courses.data ?? []).filter((course) => course.archived);
  const courseById = useMemo(() => new Map((courses.data ?? []).map((course) => [course.id, course])), [courses.data]);

  const choose = (choice: AddCourseChoice) => {
    setAdding(false);
    const target = choice === 'upload' ? routes.upload() : choice === 'canvas' ? routes.canvas() : routes.courseEdit();
    setTimeout(() => router.push(target), SHEET_DISMISS_MS);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([courses.refetch(), terms.refetch(), items.refetch(), uploads.refetch()]);
    setRefreshing(false);
  };

  const renderCourse = (course: Course) => {
    const upcoming = upcomingByCourse.get(course.id) ?? [];
    const highImpact = impacts ? upcoming.filter((item) => impacts.get(item.id)?.isHighImpact).length : 0;
    return (
      <CourseCard
        key={course.id}
        course={course}
        nextItem={upcoming[0] ?? null}
        highImpactCount={highImpact}
        today={today}
        onPress={() => router.push(routes.course(course.id))}
      />
    );
  };

  const loading = courses.isPending || terms.isPending;
  const loadError = courses.error ?? terms.error;
  const isEmpty = !loading && !loadError && (courses.data?.length ?? 0) === 0 && (uploads.data?.length ?? 0) === 0;

  return (
    <Screen
      title="Courses"
      subtitle={isEmpty ? undefined : 'Every class, its next deadline, and what matters most.'}
      headerRight={<IconButton icon="plus" fallback="+" label="Add a course" variant="primary" onPress={() => setAdding(true)} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}
    >
      {uploads.data && uploads.data.length > 0 ? (
        <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          <SectionHeader title="In progress" style={{ marginTop: 0 }} />
          {uploads.data.map((upload) => (
            <UploadStatusCard
              key={upload.id}
              upload={upload}
              course={upload.course_id ? (courseById.get(upload.course_id) ?? null) : null}
              onOpen={() => router.push(routes.review(upload.id))}
            />
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading your courses" />
          <LoadingBlock lines={2} label="Loading your courses" />
        </View>
      ) : loadError ? (
        <ErrorBanner title="Couldn't load your courses" message={errorMessage(loadError)} onRetry={() => void refresh()} />
      ) : isEmpty ? (
        <EmptyState
          tone="pink"
          title="Bring in your classes"
          message="Snap or upload a syllabus, connect Canvas, or add a course yourself — Termwise does the rest."
          actionLabel="Add your first course"
          onAction={() => setAdding(true)}
        />
      ) : (
        <View>
          {groups.map((group, index) => (
            <View key={group.key} style={{ gap: spacing.lg }}>
              <SectionHeader title={group.title} style={index === 0 && !uploads.data?.length ? { marginTop: 0 } : undefined} />
              {group.courses.map(renderCourse)}
            </View>
          ))}
          {archived.length > 0 ? (
            <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
              <Button
                label={showArchived ? 'Hide archived courses' : `Show archived courses (${archived.length})`}
                variant="ghost"
                onPress={() => setShowArchived((open) => !open)}
                accessibilityHint={showArchived ? 'Hides courses you archived' : 'Shows courses you archived'}
              />
              {showArchived ? archived.map(renderCourse) : null}
            </View>
          ) : null}
        </View>
      )}

      <AddCourseSheet visible={adding} onClose={() => setAdding(false)} onChoose={choose} />
    </Screen>
  );
}
