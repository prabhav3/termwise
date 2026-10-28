// Realtime watch on one syllabus_uploads row. Kept free of React Native so it can be tested
// against the real supabase-js client.
//
// realtime-js hands back the existing channel when one with the same topic exists, and adding
// postgres_changes callbacks to a channel that is joining or joined throws. Two screens watching
// the same upload (the Courses card under the upload modal, then the review screen) would crash
// on the second watch, and the first unmount would tear down the shared channel. So every
// watcher gets its own topic and owns its own channel.
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/** The part of the Supabase client this needs (`supabase` satisfies it). */
export interface RealtimeHost {
  channel(topic: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): Promise<unknown>;
}

/** One topic per watcher, so no two watchers ever share (or remove) a channel. */
export function uploadChannelTopic(uploadId: string, watcherId: string): string {
  return `syllabus-upload:${uploadId}:${watcherId}`;
}

/**
 * Calls `onRow` with the new row on every UPDATE of the upload and `onLive` with whether the
 * subscription is connected. Never throws: if Realtime can't be set up, it reports `onLive(false)`
 * and the caller's polling keeps the screen current. Returns the unsubscribe function.
 */
export function watchUploadRow(
  host: RealtimeHost,
  uploadId: string,
  watcherId: string,
  onRow: (row: unknown) => void,
  onLive: (live: boolean) => void,
): () => void {
  let channel: RealtimeChannel | null = null;
  try {
    channel = host.channel(uploadChannelTopic(uploadId, watcherId));
    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'syllabus_uploads', filter: `id=eq.${uploadId}` },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => onRow(payload.new),
      )
      .subscribe((status) => onLive(status === 'SUBSCRIBED'));
  } catch {
    // Realtime is only a speed-up over polling: never let it take the screen down.
    onLive(false);
    if (channel) void host.removeChannel(channel).catch(() => undefined);
    return () => undefined;
  }
  const owned = channel;
  return () => {
    onLive(false);
    void host.removeChannel(owned).catch(() => undefined);
  };
}
