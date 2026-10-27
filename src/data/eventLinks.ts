// calendar_event_links: which external event / task mirrors which item or block, per connection.
// The on-device Apple sync reads and writes these; cloud syncs maintain them server-side.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { CalendarEventLink, UUID } from '@/types/db';

import type { NewRow } from './database';
import { check, chunk, fetchAllPages, unwrap } from './helpers';
import { queryKeys } from './keys';

const WRITE_BATCH = 200;

export function fetchEventLinks(connectionId: UUID): Promise<CalendarEventLink[]> {
  return fetchAllPages((from, to) =>
    supabase.from('calendar_event_links').select('*').eq('connection_id', connectionId).order('key').range(from, to),
  );
}

export function eventLinksQueryOptions(connectionId: UUID) {
  return queryOptions({ queryKey: queryKeys.eventLinksFor(connectionId), queryFn: () => fetchEventLinks(connectionId) });
}

export function useEventLinks(connectionId: UUID | null | undefined) {
  return useQuery({ ...eventLinksQueryOptions(connectionId ?? ''), enabled: Boolean(connectionId) });
}

/** Item key used in `calendar_event_links.key`. */
export const itemLinkKey = (itemId: UUID) => `item:${itemId}`;
/** Plan-block key used in `calendar_event_links.key`. */
export const blockLinkKey = (blockKey: string) => `block:${blockKey}`;

/** Inserts or updates links by (connection_id, key). */
export function useUpsertEventLinks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (links: readonly NewRow<'calendar_event_links'>[]) => {
      const saved: CalendarEventLink[] = [];
      for (const batch of chunk(links, WRITE_BATCH)) {
        saved.push(
          ...unwrap(
            await supabase.from('calendar_event_links').upsert(batch, { onConflict: 'connection_id,key' }).select('*'),
          ),
        );
      }
      return saved;
    },
    onSuccess: async (_saved, links) => {
      const connections = new Set(links.map((link) => link.connection_id));
      await Promise.all(
        [...connections].map((id) => client.invalidateQueries({ queryKey: queryKeys.eventLinksFor(id) })),
      );
    },
  });
}

export function useDeleteEventLinks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ connectionId, ids }: { connectionId: UUID; ids: readonly UUID[] }) => {
      for (const batch of chunk(ids, WRITE_BATCH)) {
        check(await supabase.from('calendar_event_links').delete().eq('connection_id', connectionId).in('id', batch));
      }
      return connectionId;
    },
    onSuccess: (connectionId) => client.invalidateQueries({ queryKey: queryKeys.eventLinksFor(connectionId) }),
  });
}
