// focus_sessions: the pomodoro log.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { FocusSession, UUID } from '@/types/db';

import type { NewRow } from './database';
import { unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

/** Recent history is enough for streaks and "focused today" totals. */
const HISTORY_LIMIT = 500;

export async function fetchFocusSessions(): Promise<FocusSession[]> {
  return unwrap(
    await supabase.from('focus_sessions').select('*').order('started_at', { ascending: false }).limit(HISTORY_LIMIT),
  );
}

export function focusSessionsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.focusSessions(), queryFn: fetchFocusSessions });
}

/** Newest first. */
export function useFocusSessions() {
  return useQuery(focusSessionsQueryOptions());
}

export function useStartFocusSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (session: Pick<NewRow<'focus_sessions'>, 'item_id' | 'plan_block_id' | 'planned_minutes'>) =>
      unwrap(
        await supabase
          .from('focus_sessions')
          .insert({ ...session, started_at: new Date().toISOString() })
          .select('*')
          .single(),
      ),
    onSuccess: (session) => {
      client.setQueryData<FocusSession[]>(queryKeys.focusSessions(), (current) =>
        current ? [session, ...current.filter((existing) => existing.id !== session.id)] : current,
      );
    },
  });
}

export function useFinishFocusSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, focusedMinutes, completed }: { id: UUID; focusedMinutes: number; completed: boolean }) =>
      unwrap(
        await supabase
          .from('focus_sessions')
          .update({
            ended_at: new Date().toISOString(),
            focused_minutes: Math.max(0, Math.round(focusedMinutes)),
            completed,
          })
          .eq('id', id)
          .select('*')
          .single(),
      ),
    onSuccess: (session) => upsertInList(client, queryKeys.focusSessions(), session),
  });
}
