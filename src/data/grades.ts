// Grade tracker data: one read of courses + grading components + items (from the shared
// per-table caches, so nothing is fetched twice) and an optimistic score write.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { toAppError, type AppError } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import type { Course, GradingComponent, Item, UUID } from '@/types/db';

import { componentsQueryOptions } from './components';
import { coursesQueryOptions } from './courses';
import type { RowPatch } from './database';
import { unwrap, upsertInList } from './helpers';
import { itemsQueryOptions } from './items';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

export type GradebookView =
  | { status: 'loading' }
  | { status: 'error'; error: AppError; retry: () => void }
  | {
      status: 'ready';
      /** Every course, archived ones included, in creation order. */
      courses: Course[];
      components: GradingComponent[];
      items: Item[];
    };

/** Everything the grade screens read. `refresh` refetches all three tables (pull to refresh). */
export function useGradebook(): { view: GradebookView; refresh: () => Promise<void> } {
  const courses = useQuery(coursesQueryOptions());
  const components = useQuery(componentsQueryOptions());
  const items = useQuery(itemsQueryOptions());
  const { refetch: refetchCourses } = courses;
  const { refetch: refetchComponents } = components;
  const { refetch: refetchItems } = items;

  const refresh = useCallback(async () => {
    await Promise.all([refetchCourses(), refetchComponents(), refetchItems()]);
  }, [refetchCourses, refetchComponents, refetchItems]);

  // Only a load that never produced data is an error; a failed background refetch keeps the cache.
  const loadError =
    [courses, components, items].find((query) => query.error !== null && query.data === undefined)?.error ?? null;

  const view = useMemo<GradebookView>(() => {
    if (loadError) return { status: 'error', error: toAppError(loadError), retry: () => void refresh() };
    if (!courses.data || !components.data || !items.data) return { status: 'loading' };
    return { status: 'ready', courses: courses.data, components: components.data, items: items.data };
  }, [loadError, refresh, courses.data, components.data, items.data]);

  return { view, refresh };
}

export interface SaveScoreInput {
  item: Item;
  /** null clears the score. */
  score: number | null;
  pointsPossible: number | null;
}

/**
 * The columns a score write changes. A score means the work was handed in, so an item still
 * marked to-do becomes done (the planner then stops scheduling time for it).
 */
export function scoreChanges(item: Item, score: number | null, pointsPossible: number | null): RowPatch<'items'> {
  const changes: RowPatch<'items'> = { score, points_possible: pointsPossible };
  if (score !== null && (item.status === 'todo' || item.status === 'in_progress')) {
    changes.status = 'done';
    changes.completed_at = new Date().toISOString();
  }
  return changes;
}

function replaceItem(client: ReturnType<typeof useQueryClient>, id: UUID, update: (item: Item) => Item): void {
  client.setQueryData<Item[]>(queryKeys.items(), (current) => current?.map((row) => (row.id === id ? update(row) : row)));
}

/**
 * Saves (or clears) an item's score. The cached row updates at once; a failed write puts back
 * just that item, so other scores saved meanwhile stay.
 */
export function useSaveScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, score, pointsPossible }: SaveScoreInput) =>
      unwrap(
        await supabase.from('items').update(scoreChanges(item, score, pointsPossible)).eq('id', item.id).select('*').single(),
      ),
    onMutate: async ({ item, score, pointsPossible }) => {
      await client.cancelQueries({ queryKey: queryKeys.items() });
      const previous = client.getQueryData<Item[]>(queryKeys.items())?.find((row) => row.id === item.id) ?? item;
      replaceItem(client, item.id, (row) => ({ ...row, ...scoreChanges(row, score, pointsPossible) }));
      return { previous };
    },
    onError: (_error, { item }, context) => {
      const previous = context?.previous ?? item;
      replaceItem(client, item.id, () => previous);
    },
    onSuccess: (saved, { item }, context) => {
      upsertInList(client, queryKeys.items(), saved);
      const before = context?.previous ?? item;
      if (saved.status !== before.status) notifyPlanInputsChanged();
    },
  });
}
