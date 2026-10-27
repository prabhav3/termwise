// term_events: holidays, breaks, no-class days, finals periods.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { TermEvent, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

export async function fetchTermEvents(): Promise<TermEvent[]> {
  return unwrap(await supabase.from('term_events').select('*').order('start_date').order('id'));
}

export function termEventsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.termEvents(), queryFn: fetchTermEvents });
}

/** All term events in date order, or those of one course (course-less events are school-wide). */
export function useTermEvents(courseId?: UUID | null) {
  return useQuery({
    ...termEventsQueryOptions(),
    select: (events) => (courseId === undefined ? events : events.filter((event) => event.course_id === courseId)),
  });
}

export function useCreateTermEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (event: NewRow<'term_events'>) =>
      unwrap(await supabase.from('term_events').insert(event).select('*').single()),
    onSuccess: (event) => {
      upsertInList(client, queryKeys.termEvents(), event);
      notifyPlanInputsChanged();
    },
  });
}

export function useUpdateTermEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'term_events'> }) =>
      unwrap(await supabase.from('term_events').update(changes).eq('id', id).select('*').single()),
    onSuccess: (event) => {
      upsertInList(client, queryKeys.termEvents(), event);
      notifyPlanInputsChanged();
    },
  });
}

export function useDeleteTermEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('term_events').delete().eq('id', id));
      return id;
    },
    onSuccess: (id) => {
      removeFromList<TermEvent>(client, queryKeys.termEvents(), id);
      notifyPlanInputsChanged();
    },
  });
}
