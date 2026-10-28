import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { normalizeCourseRow } from '@/lib/json-columns';
import { supabase } from '@/lib/supabase';
import { nextCourseColor } from '@/theme/tokens';
import type { Course, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

/** `grade_scale` and `policies` are reshaped on read: a malformed (e.g. shared) jsonb value must not crash a screen. */
export async function fetchCourses(): Promise<Course[]> {
  return unwrap(await supabase.from('courses').select('*').order('created_at').order('id')).map(normalizeCourseRow);
}

/** Every course, archived ones included (screens filter with `useCourses`). */
export function coursesQueryOptions() {
  return queryOptions({ queryKey: queryKeys.courses(), queryFn: fetchCourses });
}

export function useCourses(options: { includeArchived?: boolean; termId?: UUID | null } = {}) {
  const { includeArchived = false, termId } = options;
  return useQuery({
    ...coursesQueryOptions(),
    select: (courses) =>
      courses.filter(
        (course) => (includeArchived || !course.archived) && (termId === undefined || course.term_id === termId),
      ),
  });
}

export function useCourse(id: UUID | null | undefined) {
  return useQuery({
    ...coursesQueryOptions(),
    enabled: Boolean(id),
    select: (courses) => courses.find((course) => course.id === id) ?? null,
  });
}

/** Everything that hangs off a course; a course delete cascades to all of it in the database. */
const COURSE_SCOPED = [
  queryKeys.components(),
  queryKeys.items(),
  queryKeys.textbooks(),
  queryKeys.termEvents(),
  queryKeys.planBlocks(),
  queryKeys.uploads(),
  queryKeys.discrepancies(),
  queryKeys.lmsCourses(),
  queryKeys.shares(),
] as const;

export type CourseInput = Omit<NewRow<'courses'>, 'color'> & { color?: string };

/** Creates a course; without an explicit color it gets the next one from the course palette. */
export function useCreateCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CourseInput) => {
      const existing = client.getQueryData<Course[]>(queryKeys.courses()) ?? (await fetchCourses());
      const course: NewRow<'courses'> = { ...input, color: input.color ?? nextCourseColor(existing.length) };
      return unwrap(await supabase.from('courses').insert(course).select('*').single());
    },
    onSuccess: (course) => {
      upsertInList(client, queryKeys.courses(), normalizeCourseRow(course));
      notifyPlanInputsChanged();
    },
  });
}

export function useUpdateCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'courses'> }) =>
      unwrap(await supabase.from('courses').update(changes).eq('id', id).select('*').single()),
    onSuccess: (course) => {
      upsertInList(client, queryKeys.courses(), normalizeCourseRow(course));
      notifyPlanInputsChanged();
    },
  });
}

export function useDeleteCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('courses').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<Course>(client, queryKeys.courses(), id);
      await invalidateAll(client, COURSE_SCOPED);
      notifyPlanInputsChanged();
    },
  });
}
