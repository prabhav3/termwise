// Local notifications for the running pomodoro, so the student hears about segment changes with
// the phone locked or the app in the background: the end of the running segment and, when a
// break starts on its own, the end of that break too (upcomingAlerts in src/lib/focus-timer.ts).
// Every change (start, resume, auto-advance) replaces the whole set, and pause / finish cancel
// it. Calls are queued so a cancel never races a schedule.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { SegmentAlert } from '@/lib/focus-timer';
import { getNotificationPermission } from '@/lib/notifications';

const ALERT_PREFIX = 'termwise-focus-segment';
/** A focus segment and the break that follows it: nothing further runs without a tap. */
const MAX_ALERTS = 2;
const ALERT_IDS = Array.from({ length: MAX_ALERTS }, (_, index) => `${ALERT_PREFIX}-${index}`);
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => undefined);
  return queue;
}

async function cancelNow(): Promise<void> {
  // Resolves even when nothing is scheduled under an id.
  await Promise.all(ALERT_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

/** Replaces the pending alerts with `alerts`. Silently skipped without permission. */
export function scheduleSegmentAlerts(alerts: readonly SegmentAlert[]): Promise<void> {
  return enqueue(async () => {
    if (!isNative) return;
    await cancelNow();
    const due = alerts.slice(0, MAX_ALERTS).filter((alert) => alert.at > Date.now() + 1_000);
    if (due.length === 0) return;
    if ((await getNotificationPermission()) !== 'granted') return;
    await Promise.all(
      due.map((alert, index) =>
        Notifications.scheduleNotificationAsync({
          identifier: ALERT_IDS[index],
          content: {
            title: alert.title,
            body: alert.body,
            sound: 'default',
            data: { kind: 'focus', url: '/focus' },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(alert.at) },
        }),
      ),
    );
  });
}

export function cancelSegmentAlerts(): Promise<void> {
  return enqueue(async () => {
    if (!isNative) return;
    await cancelNow();
  });
}
