// Settings save themselves: each change shows at once (optimistic draft) and is written ~0.7 s
// after the last tap, so a run of stepper taps becomes one profile update (and one replan).
import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ui';
import { useUpdateProfile, type ProfileUpdate } from '@/data/profile';
import { errorMessage } from '@/lib/functions';
import type { Profile } from '@/types/db';

const SAVE_DELAY_MS = 700;

type Field = keyof ProfileUpdate & keyof Profile;

function withoutSaved(draft: ProfileUpdate, saved: ProfileUpdate): ProfileUpdate {
  const next: ProfileUpdate = { ...draft };
  for (const key of Object.keys(saved) as Field[]) {
    if (next[key] === saved[key]) delete next[key];
  }
  return next;
}

export function useProfileAutosave(profile: Profile) {
  const toast = useToast();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<ProfileUpdate>({});
  const pending = useRef<ProfileUpdate>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => undefined);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length === 0) return;
    update.mutate(changes, {
      onSuccess: () => setDraft((current) => withoutSaved(current, changes)),
      onError: (error) => {
        setDraft((current) => withoutSaved(current, changes));
        toast.show({ tone: 'danger', title: "Couldn't save that change", message: errorMessage(error) });
      },
    });
  };

  // Keep the latest flush for the unmount save below (assigned outside render).
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  const set = <K extends Field>(key: K, value: ProfileUpdate[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const value = <K extends Field>(key: K): Profile[K] => {
    const drafted = draft[key];
    return drafted === undefined ? profile[key] : (drafted as Profile[K]);
  };

  return {
    value,
    set,
    /** True while a change is waiting to be saved or saving. */
    saving: update.isPending || Object.keys(draft).length > 0,
  };
}

export type ProfileAutosave = ReturnType<typeof useProfileAutosave>;
