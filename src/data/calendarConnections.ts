// calendar_connections: Apple (on-device, created by the app) and Google / Microsoft (created by
// calendar-oauth-callback). Syncing goes through src/data/integrations.ts.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { CalendarConnection, CalendarProvider, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, invalidateAll, removeFromList, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';

export async function fetchCalendarConnections(): Promise<CalendarConnection[]> {
  return unwrap(await supabase.from('calendar_connections').select('*').order('created_at'));
}

export function calendarConnectionsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.calendarConnections(), queryFn: fetchCalendarConnections });
}

export function useCalendarConnections(provider?: CalendarProvider) {
  return useQuery({
    ...calendarConnectionsQueryOptions(),
    select: (connections) =>
      provider === undefined ? connections : connections.filter((connection) => connection.provider === provider),
  });
}

/** Apple Calendar connections are per device (`device_id`); cloud ones use device_id ''. */
export function useCreateCalendarConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (connection: NewRow<'calendar_connections'>) =>
      unwrap(await supabase.from('calendar_connections').insert(connection).select('*').single()),
    onSuccess: (connection) => upsertInList(client, queryKeys.calendarConnections(), connection),
  });
}

export function useUpdateCalendarConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'calendar_connections'> }) =>
      unwrap(await supabase.from('calendar_connections').update(changes).eq('id', id).select('*').single()),
    onSuccess: (connection) => upsertInList(client, queryKeys.calendarConnections(), connection),
  });
}

/** Disconnects (its event links and stored tokens cascade). Events already pushed stay in the calendar. */
export function useDeleteCalendarConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('calendar_connections').delete().eq('id', id));
      return id;
    },
    onSuccess: async (id) => {
      removeFromList<CalendarConnection>(client, queryKeys.calendarConnections(), id);
      client.removeQueries({ queryKey: queryKeys.eventLinksFor(id) });
      await invalidateAll(client, [queryKeys.eventLinks()]);
    },
  });
}
