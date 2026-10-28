// textbooks: chapter -> page maps that turn "Read ch. 4-7" into a page count.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { normalizeTextbookRow } from '@/lib/json-columns';
import { supabase } from '@/lib/supabase';
import type { Textbook, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

/** `chapters` is reshaped on read: a malformed jsonb value must not reach the planner. */
export async function fetchTextbooks(): Promise<Textbook[]> {
  return unwrap(await supabase.from('textbooks').select('*').order('course_id').order('created_at')).map(normalizeTextbookRow);
}

export function textbooksQueryOptions() {
  return queryOptions({ queryKey: queryKeys.textbooks(), queryFn: fetchTextbooks });
}

export function useTextbooks(courseId?: UUID | null) {
  return useQuery({
    ...textbooksQueryOptions(),
    select: (books) => (courseId === undefined ? books : books.filter((book) => book.course_id === courseId)),
  });
}

export function useTextbook(id: UUID | null | undefined) {
  return useQuery({
    ...textbooksQueryOptions(),
    enabled: Boolean(id),
    select: (books) => books.find((book) => book.id === id) ?? null,
  });
}

export function useCreateTextbook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (book: NewRow<'textbooks'>) =>
      unwrap(await supabase.from('textbooks').insert(book).select('*').single()),
    onSuccess: (book) => {
      upsertInList(client, queryKeys.textbooks(), normalizeTextbookRow(book));
      notifyPlanInputsChanged();
    },
  });
}

/** Chapter map edits change reading page counts, so they replan. */
export function useUpdateTextbook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'textbooks'> }) =>
      unwrap(await supabase.from('textbooks').update(changes).eq('id', id).select('*').single()),
    onSuccess: (book) => {
      upsertInList(client, queryKeys.textbooks(), normalizeTextbookRow(book));
      notifyPlanInputsChanged();
    },
  });
}

export function useDeleteTextbook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('textbooks').delete().eq('id', id));
      return id;
    },
    onSuccess: (id) => {
      removeFromList<Textbook>(client, queryKeys.textbooks(), id);
      notifyPlanInputsChanged();
    },
  });
}
