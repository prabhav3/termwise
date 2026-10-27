// Local notifications: the morning triage digest ("1. Read pp. 101–126 · 2. Outline HIST paper").
// Everything is scheduled on-device (no push server); src/lib/planner.ts reschedules after each replan.
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { triageForDate, type EngineCourse, type PlannerSettings, type PlanResult, type TriageAction } from '@/engine';
import type { Profile } from '@/types/db';

import { addDaysISO, normalizeTime, todayISO, zonedDateTimeToDate, type ISODate } from './dates';

const TRIAGE_ID_PREFIX = 'termwise-triage-';
const TRIAGE_KIND = 'triage';
const ANDROID_CHANNEL_ID = 'morning-triage';
const DAYS_AHEAD = 7;
const MAX_ACTIONS = 3;
/** Keeps each step short enough that three of them fit an expanded lock-screen banner. */
const MAX_STEP_CHARS = 44;

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

if (isNative) {
  // Foreground arrivals still show as a banner (the student opened the app at 07:30 exactly).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// ---- permissions ---------------------------------------------------------------------

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

function toPermission(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  const iosStatus = status.ios?.status;
  if (
    status.granted ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }
  if (iosStatus === Notifications.IosAuthorizationStatus.NOT_DETERMINED || status.status === 'undetermined') {
    return 'undetermined';
  }
  return 'denied';
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!isNative) return 'denied';
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/**
 * Shows the system prompt when the student has not decided yet; otherwise reports the current
 * answer without prompting (iOS only ever prompts once — after that it lives in Settings).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNative) return 'denied';
  try {
    const current = toPermission(await Notifications.getPermissionsAsync());
    if (current !== 'undetermined') return current;
    return toPermission(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
    );
  } catch {
    return 'denied';
  }
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Morning plan',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// ---- digest (pure) -------------------------------------------------------------------------

export interface TriageDigest {
  identifier: string;
  date: ISODate;
  fireAt: Date;
  title: string;
  body: string;
}

export interface TriageDigestInput {
  plan: PlanResult;
  courses: EngineCourse[];
  settings: PlannerSettings;
  profile: Pick<Profile, 'timezone' | 'triage_notification_time'>;
  now?: Date;
  days?: number;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= MAX_STEP_CHARS ? clean : `${clean.slice(0, MAX_STEP_CHARS - 1).trimEnd()}…`;
}

/** "1. Read pp. 101–126 · 2. Outline HIST paper · 3. Psych Quiz 1 review" */
export function triageBody(actions: readonly Pick<TriageAction, 'title'>[]): string {
  return actions.map((action, index) => `${index + 1}. ${shorten(action.title)}`).join(' · ');
}

export function triageTitle(count: number): string {
  return count === 1 ? "Today's one thing" : `Today's top ${count}`;
}

/**
 * One digest per day for the next `days` days (today included while its time is still ahead),
 * skipping days with nothing to do. Future days leave out "overdue" catch-ups: by then the student
 * has probably done them, and the digest is rebuilt on every replan anyway.
 */
export function buildTriageDigests({
  plan,
  courses,
  settings,
  profile,
  now = new Date(),
  days = DAYS_AHEAD,
}: TriageDigestInput): TriageDigest[] {
  const today = todayISO(profile.timezone, now);
  const time = normalizeTime(profile.triage_notification_time);
  const digests: TriageDigest[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDaysISO(today, offset);
    const fireAt = zonedDateTimeToDate(date, time, profile.timezone);
    if (fireAt.getTime() <= now.getTime()) continue;
    const actions = triageForDate(plan, courses, { ...settings, today }, date, MAX_ACTIONS * 2)
      .filter((action) => offset === 0 || action.reason !== 'overdue')
      .slice(0, MAX_ACTIONS);
    if (actions.length === 0) continue;
    digests.push({
      identifier: `${TRIAGE_ID_PREFIX}${date}`,
      date,
      fireAt,
      title: triageTitle(actions.length),
      body: triageBody(actions),
    });
  }
  return digests;
}

// ---- scheduling ----------------------------------------------------------------------------

function isTriageRequest(request: Notifications.NotificationRequest): boolean {
  return request.identifier.startsWith(TRIAGE_ID_PREFIX) || request.content.data?.kind === TRIAGE_KIND;
}

/** Removes every scheduled triage digest (sign-out, notifications turned off). */
export async function cancelTriageNotifications(): Promise<void> {
  if (!isNative) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter(isTriageRequest)
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    );
  } catch {
    // Nothing scheduled, or the platform has no scheduler.
  }
}

export interface ScheduleTriageInput extends Omit<TriageDigestInput, 'profile'> {
  profile: Pick<Profile, 'timezone' | 'triage_notification_time' | 'notifications_enabled'>;
}

/**
 * Replaces the scheduled digests with fresh ones for the next 7 days. Never prompts: without
 * permission (or with notifications turned off in Termwise) it only clears old digests.
 * Resolves to the number of digests scheduled; failures are swallowed (notifications are a nicety).
 */
export async function scheduleTriageNotifications(input: ScheduleTriageInput): Promise<number> {
  if (!isNative) return 0;
  await cancelTriageNotifications();
  if (!input.profile.notifications_enabled) return 0;
  if ((await getNotificationPermission()) !== 'granted') return 0;
  try {
    await ensureAndroidChannel();
    const digests = buildTriageDigests(input);
    await Promise.all(
      digests.map((digest) =>
        Notifications.scheduleNotificationAsync({
          identifier: digest.identifier,
          content: {
            title: digest.title,
            body: digest.body,
            sound: false,
            data: { kind: TRIAGE_KIND, date: digest.date, url: '/' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: digest.fireAt,
            channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
          },
        }),
      ),
    );
    return digests.length;
  } catch {
    return 0;
  }
}

/**
 * Opens the route a tapped Termwise notification points at (the digest opens Today). Mount once
 * inside the signed-in navigator.
 */
export function useNotificationRouting(navigate: (path: string) => void): void {
  useEffect(() => {
    if (!isNative) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) navigate(url);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [navigate]);
}
