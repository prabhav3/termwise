// Mutations backed by Edge Functions (Canvas, iCal LMS feeds, cloud calendars). Each one
// invalidates the tables the function writes, so screens refresh without knowing the details.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import type { CalendarOAuthStartRequest, CanvasRequest, LmsSyncRequest } from '@shared/api.ts';

import {
  AppError,
  calendarOAuthFinish,
  calendarOAuthStart,
  calendarSync,
  canvasConnect,
  canvasDisconnect,
  canvasFetchSyllabus,
  canvasImport,
  canvasListCourses,
  canvasSync,
  lmsConnect,
  lmsSync,
} from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import type { Item, LmsDiscrepancy, UUID } from '@/types/db';

import type { RowPatch } from './database';
import { check, invalidateAll, requireUserId, unwrap, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

const LMS_TABLES = [queryKeys.lmsConnections(), queryKeys.lmsCourses(), queryKeys.discrepancies()] as const;
const IMPORTED_TABLES = [
  ...LMS_TABLES,
  queryKeys.courses(),
  queryKeys.components(),
  queryKeys.items(),
] as const;

// ---- Canvas ------------------------------------------------------------------------------

export function useCanvasConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ baseUrl, accessToken }: { baseUrl: string; accessToken: string }) =>
      canvasConnect(baseUrl.trim(), accessToken.trim()),
    onSuccess: async (response) => {
      client.setQueryData(queryKeys.canvasCourses(response.connection_id), { courses: response.courses });
      await invalidateAll(client, [queryKeys.lmsConnections(), queryKeys.lmsCourses()]);
    },
  });
}

export function canvasCoursesQueryOptions(connectionId: UUID) {
  return queryOptions({
    queryKey: queryKeys.canvasCourses(connectionId),
    queryFn: () => canvasListCourses(connectionId),
    staleTime: 5 * 60_000,
  });
}

/** The student's courses as Canvas lists them right now (for the course picker). */
export function useCanvasCourses(connectionId: UUID | null | undefined) {
  return useQuery({
    ...canvasCoursesQueryOptions(connectionId ?? ''),
    enabled: Boolean(connectionId),
    select: (response) => response.courses,
  });
}

export function useCanvasImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: Omit<Extract<CanvasRequest, { action: 'import' }>, 'action'>) => canvasImport(request),
    onSuccess: async () => {
      await invalidateAll(client, IMPORTED_TABLES);
      notifyPlanInputsChanged();
    },
  });
}

export function useCanvasSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: UUID) => canvasSync(connectionId),
    onSuccess: async () => {
      await invalidateAll(client, IMPORTED_TABLES);
      notifyPlanInputsChanged();
    },
  });
}

/** Copies the Canvas syllabus page into a parse job; `upload_id` is null when the page is empty. */
export function useCanvasFetchSyllabus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, externalId }: { connectionId: UUID; externalId: string }) =>
      canvasFetchSyllabus(connectionId, externalId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.uploads() }),
  });
}

export function useCanvasDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: UUID) => canvasDisconnect(connectionId),
    onSuccess: async (_ok, connectionId) => {
      client.removeQueries({ queryKey: queryKeys.canvasCourses(connectionId) });
      await invalidateAll(client, LMS_TABLES);
    },
  });
}

// ---- other LMS (iCal feeds) ----------------------------------------------------------------

export function useLmsConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: Omit<Extract<LmsSyncRequest, { action: 'connect' }>, 'action'>) => lmsConnect(request),
    onSuccess: () => invalidateAll(client, LMS_TABLES),
  });
}

export function useLmsSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: Omit<Extract<LmsSyncRequest, { action: 'sync' }>, 'action'>) => lmsSync(request),
    onSuccess: () => invalidateAll(client, LMS_TABLES),
  });
}

// ---- cloud calendars ---------------------------------------------------------------------------

/** Resolves to the consent URL to open with WebBrowser.openAuthSessionAsync(auth_url, return_url). */
export function useCalendarOAuthStart() {
  return useMutation({ mutationFn: (request: CalendarOAuthStartRequest) => calendarOAuthStart(request) });
}

/** Creates the connection from the callback's one-time `pending` code (only for the account that started). */
export function useCalendarOAuthFinish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pending: string) => calendarOAuthFinish({ pending }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.calendarConnections() }),
  });
}

/** Two-way sync; date edits made in Google/Outlook come back as items.external_change. */
export function useCalendarSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connectionId?: UUID) => calendarSync(connectionId ? { connection_id: connectionId } : {}),
    onSuccess: () =>
      invalidateAll(client, [queryKeys.calendarConnections(), queryKeys.eventLinks(), queryKeys.items()]),
  });
}

// ---- iCal subscription feed ------------------------------------------------------------------

/** Issues a new secret for the iCal feed. Calendars subscribed to the old link stop updating. */
export function useRegenerateIcsToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const userId = await requireUserId();
      return unwrap(
        await supabase.from('profiles').update({ ics_token: Crypto.randomUUID() }).eq('id', userId).select('*').single(),
      );
    },
    onSuccess: (profile) => client.setQueryData(queryKeys.profile(profile.id), profile),
  });
}

// ---- external calendar changes ------------------------------------------------------------------

/**
 * "Keep mine" for a date the student changed in Google / Outlook / Apple Calendar: clears the
 * pending change and nulls pushed_hash on every calendar link of the item, so the next sync of
 * each calendar pushes Termwise's date back out (calendar-sync contract).
 */
export function useKeepTermwiseDate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: UUID): Promise<Item> => {
      check(await supabase.from('calendar_event_links').update({ pushed_hash: null }).eq('key', `item:${itemId}`));
      return unwrap(await supabase.from('items').update({ external_change: null }).eq('id', itemId).select('*').single());
    },
    onSuccess: async (item) => {
      upsertInList(client, queryKeys.items(), item);
      await client.invalidateQueries({ queryKey: queryKeys.eventLinks() });
    },
  });
}

// ---- LMS discrepancies ----------------------------------------------------------------------------

export interface LmsStamp {
  date: string;
  /** `HH:MM`, or null when the value has no time. */
  time: string | null;
}

/** Discrepancy values are `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` for dates (points/weights otherwise). */
export function parseLmsStamp(value: string | null | undefined): LmsStamp | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value.trim());
  return match ? { date: match[1], time: match[2] ?? null } : null;
}

export type DiscrepancyAction =
  /** Adopt the LMS due date (or lock time) on the linked item, then resolve. */
  | 'use_lms'
  /**
   * The syllabus is right (or "Got it"): dismiss without changing anything. Syncs keep a dismissed
   * row dismissed until its values change; a resolved one would reopen while the difference exists.
   */
  | 'keep_syllabus'
  /** Add an LMS-only assignment to the plan as a new item, then resolve. */
  | 'add_item'
  | 'dismiss'
  | 'reopen';

const NEXT_STATUS: Record<DiscrepancyAction, LmsDiscrepancy['status']> = {
  use_lms: 'resolved',
  keep_syllabus: 'dismissed',
  add_item: 'resolved',
  dismiss: 'dismissed',
  reopen: 'open',
};

/**
 * Acts on one discrepancy. The discrepancy list updates optimistically; item changes go through
 * the normal replan signal.
 */
export function useActOnDiscrepancy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ discrepancy, action }: { discrepancy: LmsDiscrepancy; action: DiscrepancyAction }) => {
      let itemChanged = false;
      if (action === 'use_lms') {
        const stamp = parseLmsStamp(discrepancy.lms_value);
        if (!discrepancy.item_id || !stamp) throw new AppError('bad_request', "There's no LMS date to use for this one.");
        const changes: RowPatch<'items'> = { due_date: stamp.date, due_time: stamp.time };
        const item = unwrap(
          await supabase.from('items').update(changes).eq('id', discrepancy.item_id).select('*').single(),
        );
        upsertInList(client, queryKeys.items(), item);
        itemChanged = true;
      }
      if (action === 'add_item') {
        const stamp = parseLmsStamp(discrepancy.lms_value);
        const item = unwrap(
          await supabase
            .from('items')
            .insert({
              course_id: discrepancy.course_id,
              title: discrepancy.title,
              kind: 'other',
              due_date: stamp?.date ?? null,
              due_time: stamp?.time ?? null,
              source: 'lms',
            })
            .select('*')
            .single(),
        );
        upsertInList(client, queryKeys.items(), item);
        itemChanged = true;
      }
      const status = NEXT_STATUS[action];
      const saved = unwrap(
        await supabase
          .from('lms_discrepancies')
          .update({ status, resolved_at: status === 'open' ? null : new Date().toISOString() })
          .eq('id', discrepancy.id)
          .select('*')
          .single(),
      );
      return { saved, itemChanged };
    },
    onMutate: async ({ discrepancy, action }) => {
      await client.cancelQueries({ queryKey: queryKeys.discrepancies() });
      const previous = client.getQueryData<LmsDiscrepancy[]>(queryKeys.discrepancies());
      const status = NEXT_STATUS[action];
      client.setQueryData<LmsDiscrepancy[]>(queryKeys.discrepancies(), (rows) =>
        rows?.map((row) => (row.id === discrepancy.id ? { ...row, status } : row)),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(queryKeys.discrepancies(), context.previous);
    },
    onSuccess: ({ saved, itemChanged }) => {
      upsertInList(client, queryKeys.discrepancies(), saved);
      if (itemChanged) notifyPlanInputsChanged();
    },
  });
}
