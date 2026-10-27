// lms_connections: Canvas and iCal-feed LMS links. They are created by the canvas / lms-sync
// functions (see src/data/integrations.ts); students can rename or remove them here.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { LmsConnection, LmsProvider, UUID } from '@/types/db';

import { check, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

export async function fetchLmsConnections(): Promise<LmsConnection[]> {
  return unwrap(await supabase.from('lms_connections').select('*').order('created_at'));
}

export function lmsConnectionsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.lmsConnections(), queryFn: fetchLmsConnections });
}

export function useLmsConnections(provider?: LmsProvider) {
  return useQuery({
    ...lmsConnectionsQueryOptions(),
    select: (connections) =>
      provider === undefined ? connections : connections.filter((connection) => connection.provider === provider),
  });
}

export function useRenameLmsConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, displayName }: { id: UUID; displayName: string | null }) =>
      unwrap(
        await supabase
          .from('lms_connections')
          .update({ display_name: displayName?.trim() || null })
          .eq('id', id)
          .select('*')
          .single(),
      ),
    onSuccess: (connection) => upsertInList(client, queryKeys.lmsConnections(), connection),
  });
}

/**
 * Removes an iCal-feed connection (its courses, secrets and discrepancies cascade). Canvas
 * connections disconnect through `useCanvasDisconnect` so the token is revoked server-side too.
 */
export function useDeleteLmsConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('lms_connections').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<LmsConnection>(client, queryKeys.lmsConnections(), id);
      await invalidateAll(client, [queryKeys.lmsCourses(), queryKeys.discrepancies()]);
    },
  });
}
