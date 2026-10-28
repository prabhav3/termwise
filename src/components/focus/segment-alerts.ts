// A local notification at the end of the running pomodoro segment, so the student hears about
// it with the phone locked or the app in the background. One alert at a time: every change
// (start, resume, auto-advance) replaces it, and pause / finish cancel it. Calls are queued so a
// cancel never races a schedule.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getNotificationPermission } from '@/lib/notifications';

const ALERT_ID = 'termwise-focus-segment';
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => undefined);
  return queue;
}

async function cancelNow(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(ALERT_ID);
  } catch {
    // Nothing scheduled.
  }
}

/** Replaces the pending alert with one at `fireAt` (epoch ms). Silently skipped without permission. */
export function scheduleSegmentAlert(fireAt: number, content: { title: string; body: string }): Promise<void> {
  return enqueue(async () => {
    if (!isNative) return;
    await cancelNow();
    if (fireAt <= Date.now() + 1_000) return;
    if ((await getNotificationPermission()) !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      identifier: ALERT_ID,
      content: {
        title: content.title,
        body: content.body,
        sound: 'default',
        data: { kind: 'focus', url: '/focus' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
  });
}

export function cancelSegmentAlert(): Promise<void> {
  return enqueue(async () => {
    if (!isNative) return;
    await cancelNow();
  });
}
