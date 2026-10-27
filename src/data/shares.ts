// Study-group share links: rpc('create_share_link') snapshots a course (no grades, statuses or
// notes); classmates preview it with rpc('get_shared_timeline') and clone it with
// rpc('import_shared_timeline').
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppError, shareAppUrl, sharePreviewUrl } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import type { SharedTimeline, SharedTimelinePublic, UUID } from '@/types/db';

import { invalidateAll, unwrap, unwrapMaybe, upsertInList } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

export interface ShareLinks {
  /** termwise://share/<slug> — opens the import screen in the app. */
  appUrl: string;
  /** Web preview that works for classmates without the app. */
  webUrl: string;
}

export function shareLinks(slug: string): ShareLinks {
  return { appUrl: shareAppUrl(slug), webUrl: sharePreviewUrl(slug) };
}

/** The caller's own share links. */
export async function fetchShares(): Promise<SharedTimeline[]> {
  return unwrap(await supabase.from('shared_timelines').select('*').order('created_at', { ascending: false }));
}

export function sharesQueryOptions() {
  return queryOptions({ queryKey: queryKeys.shares(), queryFn: fetchShares });
}

/** The live (not revoked) share link of a course, or null. */
export function useShareForCourse(courseId: UUID | null | undefined) {
  return useQuery({
    ...sharesQueryOptions(),
    enabled: Boolean(courseId),
    select: (shares) => shares.find((share) => share.course_id === courseId && !share.revoked) ?? null,
  });
}

/** Creates the link, or refreshes the snapshot of an existing one (same slug). */
export function useCreateShareLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (courseId: UUID): Promise<{ share: SharedTimeline; links: ShareLinks }> => {
      const share = unwrap(await supabase.rpc('create_share_link', { p_course_id: courseId }));
      return { share, links: shareLinks(share.slug) };
    },
    onSuccess: ({ share }) => upsertInList<SharedTimeline>(client, queryKeys.shares(), share),
  });
}

/** Stops the link working for anyone who has not imported yet. */
export function useRevokeShareLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: UUID) =>
      unwrap(await supabase.from('shared_timelines').update({ revoked: true }).eq('id', id).select('*').single()),
    onSuccess: (share) => upsertInList(client, queryKeys.shares(), share),
  });
}

function isSharedTimelinePublic(value: unknown): value is SharedTimelinePublic {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<Record<keyof SharedTimelinePublic, unknown>>;
  const snapshot = row.snapshot as { version?: unknown; course?: unknown; items?: unknown } | undefined;
  return (
    typeof row.slug === 'string' &&
    typeof snapshot === 'object' &&
    snapshot !== null &&
    snapshot.version === 1 &&
    typeof snapshot.course === 'object' &&
    Array.isArray(snapshot.items)
  );
}

export async function fetchSharedTimeline(slug: string): Promise<SharedTimelinePublic | null> {
  const value = unwrapMaybe(await supabase.rpc('get_shared_timeline', { p_slug: slug }));
  return isSharedTimelinePublic(value) ? value : null;
}

/** A classmate's shared course (null when the slug is unknown or revoked). */
export function useSharedTimeline(slug: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.sharedTimeline(slug ?? ''),
    queryFn: () => fetchSharedTimeline(slug ?? ''),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/** Clones the shared course into the caller's account; resolves to the new course id. */
export function useImportSharedTimeline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, termId = null }: { slug: string; termId?: UUID | null }): Promise<UUID> => {
      const courseId = unwrapMaybe(await supabase.rpc('import_shared_timeline', { p_slug: slug, p_term_id: termId }));
      if (!courseId) throw new AppError('not_found', 'That share link no longer works. Ask for a new one.');
      return courseId;
    },
    onSuccess: async () => {
      await invalidateAll(client, [
        queryKeys.courses(),
        queryKeys.components(),
        queryKeys.items(),
        queryKeys.textbooks(),
        queryKeys.termEvents(),
      ]);
      notifyPlanInputsChanged();
    },
  });
}
