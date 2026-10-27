import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteAccount } from '@/lib/functions';
import { cancelTriageNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/db';

import type { UpdateRow } from './database';
import { requireUserId, unwrap, unwrapMaybe } from './helpers';
import { queryKeys } from './keys';
import { notifyPlanInputsChanged } from './plan-signal';

/** Profile columns the planner reads; changing any of them triggers a replan. */
const PLANNER_FIELDS: readonly (keyof Profile)[] = [
  'timezone',
  'study_days',
  'daily_capacity_minutes',
  'reading_pages_per_hour',
  'default_pages_per_chapter',
  'high_impact_threshold',
  'blackout_dates',
  'triage_notification_time',
  'notifications_enabled',
];

export async function fetchProfile(userId: string): Promise<Profile | null> {
  return unwrapMaybe(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
}

export function profileQueryOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.profile(userId),
    queryFn: () => fetchProfile(userId),
    staleTime: 5 * 60_000,
  });
}

export type ProfileUpdate = Omit<UpdateRow<'profiles'>, 'id' | 'ics_token' | 'created_at' | 'updated_at'>;

/**
 * Updates the signed-in student's profile (settings, onboarding). The row is written into the
 * cache immediately so the auth guard and planner see it without a refetch.
 */
export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changes: ProfileUpdate) => {
      const userId = await requireUserId();
      return unwrap(await supabase.from('profiles').update(changes).eq('id', userId).select('*').single());
    },
    onSuccess: (profile, changes) => {
      client.setQueryData(queryKeys.profile(profile.id), profile);
      if (PLANNER_FIELDS.some((field) => field in changes)) notifyPlanInputsChanged();
    },
  });
}

/**
 * Permanently deletes the account (files, rows, auth user), then ends the local session; the
 * auth guard takes the student back to sign-in.
 */
export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await deleteAccount();
      await cancelTriageNotifications();
      await supabase.auth.signOut({ scope: 'local' });
    },
    onSuccess: () => client.clear(),
  });
}
