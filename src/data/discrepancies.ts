// lms_discrepancies: where the LMS and the syllabus disagree (dates, lock times, weights).
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { LmsDiscrepancy, UUID } from '@/types/db';

import { unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

export type DiscrepancyStatus = LmsDiscrepancy['status'];

export async function fetchDiscrepancies(): Promise<LmsDiscrepancy[]> {
  return unwrap(await supabase.from('lms_discrepancies').select('*').order('created_at', { ascending: false }));
}

export function discrepanciesQueryOptions() {
  return queryOptions({ queryKey: queryKeys.discrepancies(), queryFn: fetchDiscrepancies });
}

/** Newest first; defaults to the open ones. */
export function useDiscrepancies(filter: { status?: DiscrepancyStatus | 'all'; courseId?: UUID } = {}) {
  const { status = 'open', courseId } = filter;
  return useQuery({
    ...discrepanciesQueryOptions(),
    select: (rows) =>
      rows.filter(
        (row) => (status === 'all' || row.status === status) && (courseId === undefined || row.course_id === courseId),
      ),
  });
}

export function useOpenDiscrepancyCount(courseId?: UUID) {
  return useQuery({
    ...discrepanciesQueryOptions(),
    select: (rows) =>
      rows.filter((row) => row.status === 'open' && (courseId === undefined || row.course_id === courseId)).length,
  });
}

/** resolved = "I fixed it"; dismissed = "this is fine". Re-opening clears resolved_at. */
export function useSetDiscrepancyStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: UUID; status: DiscrepancyStatus }) =>
      unwrap(
        await supabase
          .from('lms_discrepancies')
          .update({ status, resolved_at: status === 'open' ? null : new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .single(),
      ),
    onSuccess: (row) => upsertInList(client, queryKeys.discrepancies(), row),
  });
}
