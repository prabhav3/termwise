import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Term, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

export async function fetchTerms(): Promise<Term[]> {
  return unwrap(
    await supabase
      .from('terms')
      .select('*')
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  );
}

export function termsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.terms(), queryFn: fetchTerms });
}

/** Newest term first. */
export function useTerms() {
  return useQuery(termsQueryOptions());
}

/** The term new courses go into: the newest active one, or null when the student has none. */
export function useActiveTerm() {
  return useQuery({ ...termsQueryOptions(), select: (terms) => terms.find((term) => term.is_active) ?? null });
}

export function useCreateTerm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (term: NewRow<'terms'>) => unwrap(await supabase.from('terms').insert(term).select('*').single()),
    onSuccess: (term) => upsertInList(client, queryKeys.terms(), term),
  });
}

export function useUpdateTerm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'terms'> }) =>
      unwrap(await supabase.from('terms').update(changes).eq('id', id).select('*').single()),
    onSuccess: (term) => upsertInList(client, queryKeys.terms(), term),
  });
}

/** Courses keep existing (term_id becomes null); term events of the term are deleted with it. */
export function useDeleteTerm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('terms').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<Term>(client, queryKeys.terms(), id);
      await invalidateAll(client, [queryKeys.courses(), queryKeys.termEvents()]);
    },
  });
}
