import { useEffect, useState } from 'react';

import { localHour } from '@/data/plan-views';
import { readString, writeString } from '@/lib/storage';

const DISMISS_PREFIX = 'termwise.today.dismissed.';
const HOUR_REFRESH_MS = 5 * 60_000;

/**
 * A note the student can hide for the rest of `today` (stored on this device). Returns whether
 * it is hidden and a function that hides it.
 */
export function useDismissedForDay(name: string, userId: string | null | undefined, today: string): [boolean, () => void] {
  const key = `${DISMISS_PREFIX}${name}.${userId ?? 'anon'}`;
  const [dismissedOn, setDismissedOn] = useState<{ key: string; value: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    void readString(key).then((value) => {
      if (active) setDismissedOn({ key, value });
    });
    return () => {
      active = false;
    };
  }, [key]);

  const dismissed = dismissedOn?.key === key && dismissedOn.value === today;
  const dismiss = () => {
    setDismissedOn({ key, value: today });
    void writeString(key, today);
  };
  return [dismissed, dismiss];
}

/** The hour of day in the student's time zone, refreshed every few minutes (for the greeting). */
export function useLocalHour(timeZone: string | null | undefined): number {
  const [hour, setHour] = useState(() => localHour(timeZone, new Date()));

  useEffect(() => {
    const update = () => setHour(localHour(timeZone, new Date()));
    const timer = setInterval(update, HOUR_REFRESH_MS);
    const first = setTimeout(update, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [timeZone]);

  return hour;
}
