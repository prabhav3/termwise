import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { routes } from '@/components/courses/nav';
import { TermPicker, type TermSelection } from '@/components/courses/pickers';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, NBText, useToast } from '@/components/ui';
import {
  sharesQueryOptions,
  useCourses,
  useCreateTerm,
  useImportSharedTimeline,
  useSharedTimeline,
  useTerms,
} from '@/data';
import { errorMessage, toAppError } from '@/lib/functions';
import { deriveTermName } from '@/lib/import-extraction';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';
import type { Course, SharedSnapshot, UUID } from '@/types/db';

import { suggestShareTerm } from './model';

/** A course the student already has for this link: their own original, or a copy they imported. */
export interface ExistingCopy {
  course: Course;
  kind: 'own' | 'imported';
}

/** Finds the original (when the link is the student's own) or an earlier import of the same link. */
export function useExistingCopy(slug: string): ExistingCopy | null {
  const courses = useCourses({ includeArchived: true });
  const ownShare = useQuery({ ...sharesQueryOptions(), select: (shares) => shares.find((share) => share.slug === slug) ?? null });
  const list = courses.data ?? [];
  const ownCourseId = ownShare.data?.course_id;
  const own = ownCourseId ? list.find((course) => course.id === ownCourseId) : undefined;
  if (own) return { course: own, kind: 'own' };
  const imported = list.find((course) => course.shared_from_slug === slug);
  return imported ? { course: imported, kind: 'imported' } : null;
}

/**
 * Term choice + import. A new term is created first (with the course's dates); if the import
 * then fails, the retry reuses that term instead of creating a second one. The import hook
 * announces new plan inputs, so the app replans on its own.
 */
export function useShareImport(slug: string, snapshot: SharedSnapshot | null) {
  const toast = useToast();
  const terms = useTerms();
  const createTerm = useCreateTerm();
  const importShared = useImportSharedTimeline();
  const shared = useSharedTimeline(slug);
  const [picked, setPicked] = useState<TermSelection | null>(null);

  const suggestion = snapshot && terms.data ? suggestShareTerm(snapshot.course, terms.data) : null;
  const selection: TermSelection = picked ?? suggestion ?? { kind: 'none' };
  const invalid = selection.kind === 'new' && !selection.name.trim();

  const run = async () => {
    if (!snapshot || invalid) return;
    createTerm.reset();
    importShared.reset();
    try {
      let termId: UUID | null = selection.kind === 'existing' ? selection.termId : null;
      if (selection.kind === 'new') {
        const term = await createTerm.mutateAsync({
          name: selection.name.trim(),
          start_date: snapshot.course.start_date,
          end_date: snapshot.course.end_date,
          is_active: true,
        });
        termId = term.id;
        setPicked({ kind: 'existing', termId: term.id });
      }
      const courseId = await importShared.mutateAsync({ slug, termId });
      haptic('success');
      const dated = snapshot.items.filter((item) => item.due_date !== null).length;
      toast.show({
        tone: 'success',
        title: `${snapshot.course.code ?? snapshot.course.title} is in your courses`,
        message:
          dated > 0
            ? `${dated} ${dated === 1 ? 'deadline is' : 'deadlines are'} going into your plan now.`
            : 'Add deadlines any time from the course page.',
      });
      router.replace(routes.course(courseId));
    } catch (error) {
      haptic('error');
      // The link may have been turned off since the preview loaded: refetch so the screen says so.
      if (toAppError(error).code === 'not_found') void shared.refetch();
    }
  };

  return {
    terms,
    selection,
    setSelection: setPicked,
    invalid,
    suggestedTermName: snapshot ? deriveTermName(snapshot.course.start_date) : null,
    run: () => void run(),
    pending: createTerm.isPending || importShared.isPending,
    error: createTerm.error ?? importShared.error,
  };
}

export type ShareImportState = ReturnType<typeof useShareImport>;

/** Where the course goes, what the classmate gets, and what never leaves the sharer's account. */
export function ShareImportPanel({
  flow,
  existing,
  courseName,
}: {
  flow: ShareImportState;
  existing: ExistingCopy | null;
  courseName: string;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.lg }}>
      {existing ? (
        <Card color="yellow" style={{ gap: spacing.sm }}>
          <NBText variant="bodyBold">
            {existing.kind === 'own' ? 'This is your own share link.' : 'You already imported this course.'}
          </NBText>
          <NBText variant="small">
            {existing.kind === 'own'
              ? 'This is what classmates see when they open it. Importing would add a second copy of your course.'
              : 'Importing again adds a second, separate copy. Open your copy instead to keep one plan.'}
          </NBText>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <NBText variant="h3">Add it to</NBText>
        {flow.terms.isPending ? (
          <LoadingBlock lines={1} label="Loading your terms" />
        ) : flow.terms.error ? (
          <ErrorBanner
            title="Couldn't load your terms"
            message={errorMessage(flow.terms.error)}
            onRetry={() => void flow.terms.refetch()}
          />
        ) : (
          <TermPicker
            terms={flow.terms.data}
            value={flow.selection}
            onChange={flow.setSelection}
            suggestedName={flow.suggestedTermName}
          />
        )}
      </Card>

      <Card color="surfaceAlt" shadow="none" style={{ gap: spacing.xs }}>
        <NBText variant="smallBold">{`You get your own copy of ${courseName}.`}</NBText>
        <NBText variant="small" color="muted">
          Dates, readings and grade weights come with it. Your classmate’s grades, progress and notes never do, and
          changes you make stay yours.
        </NBText>
      </Card>

      {flow.error ? <ErrorBanner title="Couldn't import this course" message={errorMessage(flow.error)} /> : null}
    </View>
  );
}

/** Pinned actions: import (or open the copy the student already has). */
export function ShareImportActions({ flow, existing }: { flow: ShareImportState; existing: ExistingCopy | null }) {
  const { spacing } = useTheme();
  if (existing) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Button
          label={existing.kind === 'own' ? 'Open my course' : 'Open my copy'}
          fullWidth
          onPress={() => router.replace(routes.course(existing.course.id))}
        />
        <Button
          label="Import another copy"
          variant="ghost"
          fullWidth
          loading={flow.pending}
          disabled={flow.invalid}
          onPress={flow.run}
        />
      </View>
    );
  }
  return (
    <Button
      label="Import course"
      size="lg"
      fullWidth
      loading={flow.pending}
      disabled={flow.invalid || flow.terms.isPending}
      accessibilityHint="Adds this course and its deadlines to your plan"
      onPress={flow.run}
    />
  );
}

/** Revoked, mistyped or never-existing link. */
export function ShareLinkGone({ incomplete = false }: { incomplete?: boolean }) {
  return (
    <EmptyState
      tone="orange"
      title={incomplete ? 'That link is incomplete' : 'This link no longer works'}
      message={
        incomplete
          ? 'Part of the share link is missing. Ask your classmate to send it again.'
          : 'Your classmate may have turned it off, or it was copied wrong. Ask them for a fresh link from their course page.'
      }
      actionLabel="Go to my courses"
      onAction={() => router.replace(routes.coursesTab())}
    />
  );
}
