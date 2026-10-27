// lms_courses: courses discovered on a Canvas / LMS connection and how they map to Termwise courses.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { LmsCourse, UUID } from '@/types/db';

import { unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

export async function fetchLmsCourses(): Promise<LmsCourse[]> {
  return unwrap(await supabase.from('lms_courses').select('*').order('connection_id').order('name'));
}

export function lmsCoursesQueryOptions() {
  return queryOptions({ queryKey: queryKeys.lmsCourses(), queryFn: fetchLmsCourses });
}

export function useLmsCourses(connectionId?: UUID | null) {
  return useQuery({
    ...lmsCoursesQueryOptions(),
    select: (courses) =>
      connectionId === undefined ? courses : courses.filter((course) => course.connection_id === connectionId),
  });
}

/** The LMS course linked to a Termwise course, if any. */
export function useLmsCourseFor(courseId: UUID | null | undefined) {
  return useQuery({
    ...lmsCoursesQueryOptions(),
    enabled: Boolean(courseId),
    select: (courses) => courses.find((course) => course.linked_course_id === courseId) ?? null,
  });
}

export function useUpdateLmsCourse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: UUID;
      changes: Partial<Pick<LmsCourse, 'linked_course_id' | 'sync_enabled'>>;
    }) => unwrap(await supabase.from('lms_courses').update(changes).eq('id', id).select('*').single()),
    onSuccess: (course) => upsertInList(client, queryKeys.lmsCourses(), course),
  });
}
