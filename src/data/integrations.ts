// Mutations backed by Edge Functions (Canvas, iCal LMS feeds, cloud calendars). Each one
// invalidates the tables the function writes, so screens refresh without knowing the details.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CalendarOAuthStartRequest, CanvasRequest, LmsSyncRequest } from '@shared/api.ts';

import {
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
import type { UUID } from '@/types/db';

import { invalidateAll } from './helpers';
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

/** Two-way sync; date edits made in Google/Outlook come back as items.external_change. */
export function useCalendarSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connectionId?: UUID) => calendarSync(connectionId ? { connection_id: connectionId } : {}),
    onSuccess: () =>
      invalidateAll(client, [queryKeys.calendarConnections(), queryKeys.eventLinks(), queryKeys.items()]),
  });
}
