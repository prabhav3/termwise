// grading_components: a course's grading breakdown ("Midterm 25%", "Quizzes 15%, drop lowest").
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { GradingComponent, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

export async function fetchComponents(): Promise<GradingComponent[]> {
  return unwrap(
    await supabase.from('grading_components').select('*').order('course_id').order('sort_order').order('created_at'),
  );
}

export function componentsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.components(), queryFn: fetchComponents });
}

/** All components, or one course's in display order. */
export function useComponents(courseId?: UUID | null) {
  return useQuery({
    ...componentsQueryOptions(),
    select: (components) =>
      courseId === undefined ? components : components.filter((component) => component.course_id === courseId),
  });
}

export function useCreateComponent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (component: NewRow<'grading_components'>) =>
      unwrap(await supabase.from('grading_components').insert(component).select('*').single()),
    onSuccess: (component) => {
      upsertInList(client, queryKeys.components(), component);
      notifyPlanInputsChanged();
    },
  });
}

export function useUpdateComponent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'grading_components'> }) =>
      unwrap(await supabase.from('grading_components').update(changes).eq('id', id).select('*').single()),
    onSuccess: (component) => {
      upsertInList(client, queryKeys.components(), component);
      notifyPlanInputsChanged();
    },
  });
}

/** Items of the component keep existing with component_id = null. */
export function useDeleteComponent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('grading_components').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<GradingComponent>(client, queryKeys.components(), id);
      await invalidateAll(client, [queryKeys.items()]);
      notifyPlanInputsChanged();
    },
  });
}
