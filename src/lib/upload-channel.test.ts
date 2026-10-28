import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadChannelTopic, watchUploadRow, type RealtimeHost } from './upload-channel';

/** A WebSocket that never connects: channels stay `joining`, the state that made `.on()` throw. */
class PendingSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  constructor(readonly url: string) {}
  send() {}
  close() {
    this.readyState = 3;
  }
}

let client: SupabaseClient | null = null;

function makeClient(): SupabaseClient {
  client = createClient('http://127.0.0.1:54321', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: PendingSocket as unknown as typeof WebSocket },
  });
  return client;
}

afterEach(async () => {
  if (!client) return;
  await client.removeAllChannels();
  client.realtime.disconnect();
  client = null;
});

const noop = () => undefined;

describe('watchUploadRow', () => {
  it('lets two screens watch the same upload (the Courses card and the review screen)', () => {
    const supabase = makeClient();
    // The library behaviour behind the crash: one topic, one channel, no callbacks after subscribe.
    supabase.channel('same').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'x' }, noop).subscribe();
    expect(() =>
      supabase.channel('same').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'x' }, noop),
    ).toThrow(/after `subscribe\(\)`/);

    const first = watchUploadRow(supabase, 'u1', 'card', noop, noop);
    expect(() => watchUploadRow(supabase, 'u1', 'review', noop, noop)).not.toThrow();
    const topics = supabase.getChannels().map((channel) => channel.topic);
    expect(topics).toContain(`realtime:${uploadChannelTopic('u1', 'card')}`);
    expect(topics).toContain(`realtime:${uploadChannelTopic('u1', 'review')}`);

    // Unmounting one watcher leaves the other's subscription in place.
    first();
    const remaining = supabase.getChannels().map((channel) => channel.topic);
    expect(remaining).not.toContain(`realtime:${uploadChannelTopic('u1', 'card')}`);
    expect(remaining).toContain(`realtime:${uploadChannelTopic('u1', 'review')}`);
  });

  it('gives every watcher of an upload its own topic', () => {
    expect(uploadChannelTopic('u1', 'a')).not.toBe(uploadChannelTopic('u1', 'b'));
    expect(uploadChannelTopic('u1', 'a')).not.toBe(uploadChannelTopic('u2', 'a'));
  });

  it('falls back to polling instead of throwing when Realtime setup fails', () => {
    const removeChannel = vi.fn(() => Promise.resolve('ok'));
    const broken = {
      on: () => {
        throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`.');
      },
    } as unknown as RealtimeChannel;
    const host: RealtimeHost = { channel: () => broken, removeChannel };
    const onLive = vi.fn();

    let unsubscribe: () => void = noop;
    expect(() => {
      unsubscribe = watchUploadRow(host, 'u1', 'w', noop, onLive);
    }).not.toThrow();
    expect(onLive).toHaveBeenLastCalledWith(false);
    expect(removeChannel).toHaveBeenCalledWith(broken);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('passes the updated row on and reports the connection state', () => {
    let deliver: (payload: { new: unknown }) => void = noop;
    let report: (status: string) => void = noop;
    const channel = {
      on: (_type: string, _filter: unknown, callback: typeof deliver) => {
        deliver = callback;
        return channel;
      },
      subscribe: (callback: typeof report) => {
        report = callback;
        return channel;
      },
    } as unknown as RealtimeChannel;
    const removeChannel = vi.fn(() => Promise.resolve('ok'));
    const onRow = vi.fn();
    const onLive = vi.fn();

    const unsubscribe = watchUploadRow({ channel: () => channel, removeChannel }, 'u1', 'w', onRow, onLive);
    report('SUBSCRIBED');
    expect(onLive).toHaveBeenLastCalledWith(true);
    deliver({ new: { id: 'u1', status: 'processing' } });
    expect(onRow).toHaveBeenCalledWith({ id: 'u1', status: 'processing' });
    report('CHANNEL_ERROR');
    expect(onLive).toHaveBeenLastCalledWith(false);

    unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
