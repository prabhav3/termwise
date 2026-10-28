// syllabus_uploads: AI parse jobs. The app creates the row, uploads files to
// `syllabi/<uid>/<upload_id>/<n>.<ext>`, starts parse-syllabus, then watches the row with
// useUploadStatus() until it reaches needs_review or failed.
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { parseSyllabus } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { watchUploadRow } from '@/lib/upload-channel';
import type { SyllabusUpload, UploadStatus, UUID } from '@/types/db';

import type { NewRow, RowPatch } from './database';
import { check, removeFromList, unwrap, unwrapMaybe, upsertInList } from './helpers';
import { queryKeys } from './keys';

/** Polling cadence while Realtime is not connected (progress_note changes about every 3 s). */
const POLL_MS = 3_000;
/** Safety-net polling while Realtime is connected (it can drop events silently). */
const LIVE_POLL_MS = 15_000;

const TERMINAL: ReadonlySet<UploadStatus> = new Set(['needs_review', 'imported', 'failed']);

export function isUploadSettled(status: UploadStatus | null | undefined): boolean {
  return status !== null && status !== undefined && TERMINAL.has(status);
}

export async function fetchUploads(): Promise<SyllabusUpload[]> {
  return unwrap(await supabase.from('syllabus_uploads').select('*').order('created_at', { ascending: false }));
}

export async function fetchUpload(id: UUID): Promise<SyllabusUpload | null> {
  return unwrapMaybe(await supabase.from('syllabus_uploads').select('*').eq('id', id).maybeSingle());
}

export function uploadsQueryOptions() {
  return queryOptions({ queryKey: queryKeys.uploads(), queryFn: fetchUploads });
}

export function uploadQueryOptions(id: UUID) {
  return queryOptions({ queryKey: queryKeys.upload(id), queryFn: () => fetchUpload(id) });
}

/** Newest first. */
export function useUploads() {
  return useQuery(uploadsQueryOptions());
}

/** Parses waiting for the student's review. */
export function usePendingReviews() {
  return useQuery({
    ...uploadsQueryOptions(),
    select: (uploads) => uploads.filter((upload) => upload.status === 'needs_review'),
  });
}

export function useUpload(id: UUID | null | undefined) {
  return useQuery({ ...uploadQueryOptions(id ?? ''), enabled: Boolean(id) });
}

function writeUpload(client: QueryClient, upload: SyllabusUpload) {
  client.setQueryData(queryKeys.upload(upload.id), upload);
  upsertInList(client, queryKeys.uploads(), upload);
}

type UploadProgress = Pick<SyllabusUpload, 'id' | 'status' | 'progress_note' | 'error' | 'updated_at'>;

function readProgress(value: unknown): UploadProgress | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<Record<keyof UploadProgress, unknown>>;
  if (typeof row.id !== 'string' || typeof row.status !== 'string') return null;
  return {
    id: row.id,
    status: row.status as UploadStatus,
    progress_note: typeof row.progress_note === 'string' ? row.progress_note : null,
    error: typeof row.error === 'string' ? row.error : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export interface UploadStatusResult {
  upload: SyllabusUpload | null;
  status: UploadStatus | null;
  /** Live line from the parser ("Reading the grading breakdown…"), null when idle. */
  progressNote: string | null;
  /** Student-safe failure message when status is `failed`. */
  error: string | null;
  /** needs_review, imported or failed: nothing more will change on its own. */
  settled: boolean;
  /** True while the Realtime subscription is connected (polling is the fallback). */
  live: boolean;
  isLoading: boolean;
  /** The row could not be loaded (network, or it was deleted). */
  loadError: Error | null;
  refetch: () => void;
}

/**
 * Watches one parse job: Realtime updates on syllabus_uploads, plus polling every 3 s while
 * Realtime is unavailable. Stops polling once the job settles.
 */
export function useUploadStatus(id: UUID | null | undefined): UploadStatusResult {
  const client = useQueryClient();
  const watcherId = useId();
  const [live, setLive] = useState(false);

  const query = useQuery({
    ...uploadQueryOptions(id ?? ''),
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: (current) => (isUploadSettled(current.state.data?.status) ? false : live ? LIVE_POLL_MS : POLL_MS),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!id) return;
    // Each hook instance owns its channel: see src/lib/upload-channel.ts.
    return watchUploadRow(
      supabase,
      id,
      watcherId,
      (row) => {
        const progress = readProgress(row);
        if (!progress || progress.id !== id) return;
        const cached = client.getQueryData<SyllabusUpload | null>(queryKeys.upload(id));
        if (cached) writeUpload(client, { ...cached, ...progress });
        // The extraction can be large: fetch the full row once the job settles.
        if (isUploadSettled(progress.status) || !cached) {
          void client.invalidateQueries({ queryKey: queryKeys.upload(id) });
          void client.invalidateQueries({ queryKey: queryKeys.uploads(), exact: true });
        }
      },
      setLive,
    );
  }, [id, client, watcherId]);

  const upload = query.data ?? null;
  return {
    upload,
    status: upload?.status ?? null,
    progressNote: upload?.progress_note ?? null,
    error: upload?.status === 'failed' ? (upload.error ?? "We couldn't read that syllabus. Please try again.") : null,
    settled: isUploadSettled(upload?.status),
    live,
    isLoading: query.isPending && Boolean(id),
    loadError: query.error,
    refetch: () => void query.refetch(),
  };
}

export function useCreateUpload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (upload: NewRow<'syllabus_uploads'>) =>
      unwrap(await supabase.from('syllabus_uploads').insert(upload).select('*').single()),
    onSuccess: (upload) => writeUpload(client, upload),
  });
}

export function useUpdateUpload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: UUID; changes: RowPatch<'syllabus_uploads'> }) =>
      unwrap(await supabase.from('syllabus_uploads').update(changes).eq('id', id).select('*').single()),
    onSuccess: (upload) => writeUpload(client, upload),
  });
}

/** Starts (or retries) the AI parse. The function answers 202 at once; watch with useUploadStatus. */
export function useStartParse() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: UUID) => parseSyllabus({ upload_id: uploadId }),
    onSuccess: ({ upload_id }) => {
      const cached = client.getQueryData<SyllabusUpload | null>(queryKeys.upload(upload_id));
      if (cached) writeUpload(client, { ...cached, status: 'processing', error: null });
      void client.invalidateQueries({ queryKey: queryKeys.upload(upload_id) });
    },
    // e.g. 415 unsupported_file also marks the row failed server-side.
    onError: (_error, uploadId) => void client.invalidateQueries({ queryKey: queryKeys.upload(uploadId) }),
  });
}

/** Removes the job row (its storage files are cleaned up by the caller). */
export function useDeleteUpload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) => {
      check(await supabase.from('syllabus_uploads').delete().eq('id', id));
      return id;
    },
    onSuccess: (id) => {
      removeFromList<SyllabusUpload>(client, queryKeys.uploads(), id);
      client.removeQueries({ queryKey: queryKeys.upload(id) });
    },
  });
}
