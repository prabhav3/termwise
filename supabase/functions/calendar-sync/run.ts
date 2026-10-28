// One sync run for one Google / Microsoft connection: read the provider, plan with the pure
// planCalendarSync (calendar-model.ts), apply the plan, and record links, external changes, and
// the cursor. Provider failures never abort silently: each lands in the result's errors[].
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarSyncResult, CloudCalendarProvider } from '../_shared/api.ts';
import {
  type CalendarAdapter,
  type CalendarEntry,
  type DesiredEntry,
  entryHash,
  type ExternalKind,
  type ExternalSnapshot,
  type LinkState,
  mapLimit,
  type PendingChange,
  planCalendarSync,
  ProviderError,
  ReauthRequiredError,
} from '../_shared/calendar-model.ts';
import { GoogleCalendarAdapter } from '../_shared/google.ts';
import { MicrosoftCalendarAdapter } from '../_shared/microsoft.ts';
import type { StudentCalendar } from './desired.ts';
import { tokenSource } from './tokens.ts';

const PROVIDER_CONCURRENCY = 4;
const MAX_ERRORS = 20;
const PROVIDER_LABELS: Record<CloudCalendarProvider, string> = { google: 'Google', microsoft: 'Outlook' };

export const CONNECTION_COLUMNS = 'id, provider, status, external_calendar_id, task_list_id, delivery, sync_plan_blocks, sync_cursor';
export interface ConnectionRow {
  id: string;
  provider: CloudCalendarProvider;
  status: 'active' | 'needs_reauth' | 'disconnected';
  external_calendar_id: string | null;
  task_list_id: string | null;
  delivery: 'all_day_event' | 'task';
  sync_plan_blocks: boolean;
  sync_cursor: string | null;
}

export interface RunDeps {
  userDb: SupabaseClient;
  adminDb: SupabaseClient;
  userId: string;
}

interface LinkWrite {
  key: string;
  external_id: string;
  pushed_hash: string;
  pushed_date: string;
}

class ErrorLog {
  readonly messages: string[] = [];
  private dropped = 0;

  constructor(private readonly provider: CloudCalendarProvider) {}

  add(message: string): void {
    if (this.messages.length < MAX_ERRORS) this.messages.push(message);
    else this.dropped++;
  }

  providerError(action: string, err: unknown): void {
    const label = PROVIDER_LABELS[this.provider];
    if (err instanceof ProviderError) this.add(`${label}: couldn't ${action} (${err.message})`);
    else this.add(`${label}: couldn't ${action}.`);
  }

  list(): string[] {
    return this.dropped > 0 ? [...this.messages, `…and ${this.dropped} more problem${this.dropped === 1 ? '' : 's'}.`] : this.messages;
  }
}

function adapterFor(provider: CloudCalendarProvider, tokens: Awaited<ReturnType<typeof tokenSource>>): CalendarAdapter {
  return provider === 'google' ? new GoogleCalendarAdapter(tokens) : new MicrosoftCalendarAdapter(tokens);
}

async function loadLinks(db: SupabaseClient, connectionId: string): Promise<LinkState[]> {
  const { data, error } = await db
    .from('calendar_event_links')
    .select('id, key, external_id, external_kind, pushed_hash, pushed_date, deleted_externally')
    .eq('connection_id', connectionId)
    .overrideTypes<LinkState[], { merge: false }>();
  if (error) throw new Error(`calendar-sync: link lookup failed (${error.code})`);
  return data ?? [];
}

async function updateConnection(db: SupabaseClient, connectionId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('calendar_connections').update(patch).eq('id', connectionId);
  if (error) console.error(`calendar-sync: connection update failed (${error.code})`);
}

async function deleteLinks(db: SupabaseClient, ids: string[], log: ErrorLog): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from('calendar_event_links').delete().in('id', ids.slice(i, i + 200));
    if (error) log.add(`Couldn't tidy up old calendar links (${error.code}).`);
  }
}

export async function syncConnection(deps: RunDeps, connection: ConnectionRow, calendar: StudentCalendar): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    connection_id: connection.id,
    provider: connection.provider,
    created: 0,
    updated: 0,
    deleted: 0,
    external_changes: 0,
    errors: [],
  };
  const log = new ErrorLog(connection.provider);
  const label = PROVIDER_LABELS[connection.provider];
  const now = new Date().toISOString();

  try {
    const tokens = await tokenSource(deps.adminDb, connection.id, connection.provider);
    const adapter = adapterFor(connection.provider, tokens);
    const kind: ExternalKind = connection.delivery === 'task' ? 'task' : 'event';
    const tz = calendar.timeZone;

    // 1. The dedicated "Termwise" calendar / task list, and what is in it now.
    const knownId = kind === 'event' ? connection.external_calendar_id : connection.task_list_id;
    let containerId = await adapter.ensureContainer(kind, knownId, tz);
    let links = await loadLinks(deps.userDb, connection.id);
    let snapshot: ExternalSnapshot | null = null;
    let cursor: string | null = kind === 'event' && containerId === knownId ? connection.sync_cursor : null;
    let snapshotOk = false;
    try {
      ({ snapshot, cursor } = await adapter.snapshot(kind, containerId, cursor, tz));
      snapshotOk = true;
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err;
      if (err instanceof ProviderError && err.isGone && knownId) {
        // The student deleted the Termwise calendar or list: start over in a fresh one.
        await deleteLinks(deps.userDb, links.filter((l) => l.external_kind === kind).map((l) => l.id), log);
        links = links.filter((l) => l.external_kind !== kind);
        containerId = await adapter.ensureContainer(kind, null, tz);
        ({ snapshot, cursor } = await adapter.snapshot(kind, containerId, null, tz));
        snapshotOk = true;
      } else {
        log.providerError('read your Termwise calendar, so only Termwise changes were sent', err);
      }
    }
    if (containerId !== knownId) {
      await updateConnection(deps.userDb, connection.id, kind === 'event' ? { external_calendar_id: containerId } : { task_list_id: containerId });
    }

    // 2. Plan.
    const entries: CalendarEntry[] = [...calendar.itemEntries, ...(connection.sync_plan_blocks ? calendar.blockEntries : [])];
    const desired: DesiredEntry[] = await Promise.all(entries.map(async (entry) => ({ entry, hash: await entryHash(entry, kind) })));
    const pending = new Map<string, PendingChange>();
    const otherProviderPending = new Set<string>();
    const doneItems = new Set<string>();
    for (const item of calendar.items.values()) {
      if (item.status === 'done') doneItems.add(item.id);
      if (!item.external_change) continue;
      if (item.external_change.provider === connection.provider) pending.set(item.id, item.external_change);
      else otherProviderPending.add(item.id);
    }
    const plan = planCalendarSync({ desired, links, kind, snapshot, pendingChanges: pending, doneItems });

    // 3. Apply.
    const linkWrites: LinkWrite[] = [];
    const linkDeletes: string[] = plan.dropLinks.map((l) => l.id);
    const pushed = (entry: CalendarEntry, externalId: string, hash: string) =>
      linkWrites.push({ key: entry.key, external_id: externalId, pushed_hash: hash, pushed_date: entry.date });

    await mapLimit(plan.create, PROVIDER_CONCURRENCY, async ({ entry, hash }) => {
      try {
        pushed(entry, await adapter.create(kind, containerId, entry), hash);
        result.created++;
      } catch (err) {
        if (err instanceof ReauthRequiredError) throw err;
        log.providerError(`add “${entry.title}”`, err);
      }
    });
    await mapLimit(plan.update, PROVIDER_CONCURRENCY, async ({ desired: { entry, hash }, externalId }) => {
      try {
        await adapter.update(kind, containerId, externalId, entry);
        pushed(entry, externalId, hash);
        result.updated++;
      } catch (err) {
        if (err instanceof ReauthRequiredError) throw err;
        if (!(err instanceof ProviderError && err.isGone)) {
          log.providerError(`update “${entry.title}”`, err);
          return;
        }
        // Deleted on their side after our last look, while ours changed: put it back.
        try {
          pushed(entry, await adapter.create(kind, containerId, entry), hash);
          result.created++;
        } catch (createErr) {
          if (createErr instanceof ReauthRequiredError) throw createErr;
          log.providerError(`add “${entry.title}”`, createErr);
        }
      }
    });
    await mapLimit(plan.remove, PROVIDER_CONCURRENCY, async (link) => {
      // Links from the other delivery mode live in the other container.
      const container = link.external_kind === kind ? containerId : link.external_kind === 'event' ? connection.external_calendar_id : connection.task_list_id;
      try {
        if (container) await adapter.remove(link.external_kind, container, link.external_id);
        linkDeletes.push(link.id);
        result.deleted++;
      } catch (err) {
        if (err instanceof ReauthRequiredError) throw err;
        log.providerError('remove an old entry', err);
      }
    });
    await mapLimit(plan.removeOrphans, PROVIDER_CONCURRENCY, async (externalId) => {
      try {
        await adapter.remove(kind, containerId, externalId);
        result.deleted++;
      } catch (err) {
        if (err instanceof ReauthRequiredError) throw err;
        log.providerError('remove a leftover entry', err);
      }
    });

    // 4. Changes the student made in their calendar app, for review in Termwise.
    for (const change of plan.externalChanges) {
      if (otherProviderPending.has(change.itemId)) continue; // one pending decision at a time
      const externalChange = {
        provider: connection.provider,
        new_due_date: change.newDate,
        new_due_time: change.newTime,
        detected_at: now,
        ...(change.deleted ? { deleted: true } : {}),
      };
      const { error } = await deps.userDb.from('items').update({ external_change: externalChange }).eq('id', change.itemId);
      if (error) log.add(`Couldn't save a date change from ${label} (${error.code}).`);
      else result.external_changes++;
    }

    // 5. Bookkeeping.
    // Deletes first: a replaced link (delivery switched) reuses its key.
    await deleteLinks(deps.userDb, linkDeletes, log);
    if (linkWrites.length > 0) {
      const { error } = await deps.userDb.from('calendar_event_links').upsert(
        linkWrites.map((w) => ({
          user_id: deps.userId,
          connection_id: connection.id,
          key: w.key,
          external_id: w.external_id,
          external_kind: kind,
          pushed_hash: w.pushed_hash,
          pushed_date: w.pushed_date,
          last_seen_at: now,
          // Clears a tombstone whose row could not be deleted above.
          deleted_externally: false,
        })),
        { onConflict: 'connection_id,key' },
      );
      if (error) log.add(`Couldn't record what was sent to ${label} (${error.code}); the next sync will repair it.`);
    }
    // Deleted in their calendar: keep the row so the item isn't pushed again (see planCalendarSync).
    const tombstones = plan.tombstones.map((l) => l.id);
    for (let i = 0; i < tombstones.length; i += 200) {
      const { error } = await deps.userDb
        .from('calendar_event_links')
        .update({ deleted_externally: true, last_seen_at: now })
        .in('id', tombstones.slice(i, i + 200));
      if (error) log.add(`Couldn't record an entry you deleted in ${label} (${error.code}).`);
    }
    const seen = plan.unchanged.map((l) => l.id);
    for (let i = 0; i < seen.length; i += 200) {
      const { error } = await deps.userDb.from('calendar_event_links').update({ last_seen_at: now }).in('id', seen.slice(i, i + 200));
      if (error) log.add(`Couldn't update calendar links (${error.code}).`);
    }

    result.errors = log.list();
    await updateConnection(deps.userDb, connection.id, {
      // Keep the previous cursor when the provider couldn't be read this time.
      sync_cursor: kind === 'event' ? (snapshotOk ? cursor : connection.sync_cursor) : null,
      last_synced_at: now,
      last_error: result.errors[0] ?? null,
      status: 'active',
    });
    return result;
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      log.add(`${label} access was revoked or expired. Reconnect ${label} in Termwise to keep syncing.`);
      result.errors = log.list();
      await updateConnection(deps.adminDb, connection.id, { status: 'needs_reauth', last_error: result.errors[result.errors.length - 1] });
      return result;
    }
    if (err instanceof ProviderError) log.providerError('finish syncing', err);
    else {
      console.error(`calendar-sync: ${connection.provider} run failed`, err instanceof Error ? err.message : 'unknown');
      log.add(`${label} sync stopped early. Please try again.`);
    }
    result.errors = log.list();
    await updateConnection(deps.userDb, connection.id, { last_error: result.errors[0] ?? null });
    return result;
  }
}
