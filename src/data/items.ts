// items: every exam, paper, reading, ... from syllabi, Canvas, shares, or entered by hand.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Item, ItemStatus, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, chunk, fetchAllPages, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

const INSERT_BATCH = 200;

export function fetchItems(): Promise<Item[]> {
  return fetchAllPages((from, to) =>
    supabase.from('items').select('*').order('due_date', { nullsFirst: false }).order('id').range(from, to),
  );
}

export function itemsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.items(), queryFn: fetchItems });
}

/** All items (soonest due first, undated last), or one course's. */
export function useItems(courseId?: UUID | null) {
  return useQuery({
    ...itemsQueryOptions(),
    select: (items) => (courseId === undefined ? items : items.filter((item) => item.course_id === courseId)),
  });
}

export function useItem(id: UUID | null | undefined) {
  return useQuery({
    ...itemsQueryOptions(),
    enabled: Boolean(id),
    select: (items) => items.find((item) => item.id === id) ?? null,
  });
}

/** Items whose date the student changed in Google/Outlook, awaiting a decision. */
export function useItemsWithExternalChanges() {
  return useQuery({ ...itemsQueryOptions(), select: (items) => items.filter((item) => item.external_change !== null) });
}

function afterItemWrite(client: ReturnType<typeof useQueryClient>, item: Item) {
  upsertInList(client, queryKeys.items(), item);
  notifyPlanInputsChanged();
}

export function useCreateItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (item: NewRow<'items'>) => unwrap(await supabase.from('items').insert(item).select('*').single()),
    onSuccess: (item) => afterItemWrite(client, item),
  });
}

/** Bulk insert (imports); one replan for the whole batch. */
export function useCreateItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: readonly NewRow<'items'>[]) => {
      const created: Item[] = [];
      for (const batch of chunk(items, INSERT_BATCH)) {
        created.push(...unwrap(await supabase.from('items').insert(batch).select('*')));
      }
      return created;
    },
    onSuccess: async () => {
      await invalidateAll(client, [queryKeys.items()]);
      notifyPlanInputsChanged();
    },
  });
}

export function useUpdateItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'items'> }) =>
      unwrap(await supabase.from('items').update(changes).eq('id', id).select('*').single()),
    onSuccess: (item) => afterItemWrite(client, item),
  });
}

/** Done stamps completed_at; any other status clears it. */
export function useSetItemStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: UUID; status: ItemStatus }) =>
      unwrap(
        await supabase
          .from('items')
          .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
          .eq('id', id)
          .select('*')
          .single(),
      ),
    onSuccess: (item) => afterItemWrite(client, item),
  });
}

/** Records a grade (null clears it). Scores do not change the plan, so no replan. */
export function useSetItemScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, score, pointsPossible }: { id: UUID; score: number | null; pointsPossible?: number | null }) =>
      unwrap(
        await supabase
          .from('items')
          .update(pointsPossible === undefined ? { score } : { score, points_possible: pointsPossible })
          .eq('id', id)
          .select('*')
          .single(),
      ),
    onSuccess: (item) => upsertInList(client, queryKeys.items(), item),
  });
}

/**
 * Accept: adopt the date the student set in their external calendar (or mark the item done when
 * they deleted the event). Reject: keep Termwise's date; the next sync pushes it back out.
 */
export function useResolveExternalChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, accept }: { item: Item; accept: boolean }) => {
      const change = item.external_change;
      let changes: RowPatch<'items'> = { external_change: null };
      if (accept && change) {
        changes = change.deleted
          ? { external_change: null, status: 'done', completed_at: new Date().toISOString() }
          : { external_change: null, due_date: change.new_due_date, due_time: change.new_due_time };
      }
      return unwrap(await supabase.from('items').update(changes).eq('id', item.id).select('*').single());
    },
    onSuccess: (item) => afterItemWrite(client, item),
  });
}

/** Deletes the item and (by cascade) its plan blocks. */
export function useDeleteItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('items').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<Item>(client, queryKeys.items(), id);
      await invalidateAll(client, [queryKeys.planBlocks(), queryKeys.discrepancies()]);
      notifyPlanInputsChanged();
    },
  });
}
