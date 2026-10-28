// Focus-screen glue: turning a plan block / item / queue entry into a session task, and the
// clock helpers the screen needs. Pure except for the React hooks at the bottom.
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { focusLabel, pomodoroCycles, type FocusTask } from '@/engine';
import { useFocusSession, type FocusTaskInfo, type TimerSegment } from '@/lib/focus-timer';
import type { PlanSnapshot } from '@/lib/planner';

export const DEFAULT_FOCUS_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;
const MIN_LONG_BREAK = 15;
const MAX_SESSION_MINUTES = 240;

export interface PomodoroSettings {
  focus: number;
  shortBreak: number;
}

/** The parts of the plan snapshot a focus task is built from (stable references from usePlan). */
export type PlanSource = Pick<PlanSnapshot, 'plan' | 'courses'>;

export function segmentsFor(minutes: number, settings: PomodoroSettings): TimerSegment[] {
  return pomodoroCycles(minutes, settings.focus, settings.shortBreak, Math.max(MIN_LONG_BREAK, settings.shortBreak));
}

/** A session for one plan block (any date — the link may come from a notification or the week view). */
export function taskForBlock(snapshot: PlanSource, blockKey: string): FocusTaskInfo | null {
  const block = snapshot.plan.blocks.find((candidate) => candidate.key === blockKey);
  if (!block) return null;
  const item = snapshot.plan.annotated.find((candidate) => candidate.id === block.item_id);
  const course = snapshot.courses.find((candidate) => candidate.id === block.course_id);
  return {
    blockKey: block.key,
    itemId: block.item_id,
    courseId: block.course_id,
    label: focusLabel(item ?? { title: block.label }, course, block.minutes),
    detail: block.label,
    minutes: block.minutes,
  };
}

/** A session for an item with no block today (e.g. "Finish and submit" on its due date). */
export function taskForItem(snapshot: PlanSource, itemId: string, minutes: number): FocusTaskInfo | null {
  const item = snapshot.plan.annotated.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const course = snapshot.courses.find((candidate) => candidate.id === item.course_id);
  const length = clampMinutes(minutes);
  return {
    blockKey: null,
    itemId: item.id,
    courseId: item.course_id,
    label: focusLabel(item, course, length),
    detail: null,
    minutes: length,
  };
}

/** A focusQueue entry (already capped at one focus segment by the engine). */
export function taskFromQueue(snapshot: PlanSource, task: FocusTask): FocusTaskInfo {
  const block = snapshot.plan.blocks.find((candidate) => candidate.key === task.block_key);
  return {
    blockKey: task.block_key,
    itemId: task.item_id,
    courseId: task.course_id,
    label: task.label,
    detail: block?.label ?? null,
    minutes: task.minutes,
  };
}

export function freeTask(minutes: number): FocusTaskInfo {
  const length = clampMinutes(minutes);
  return {
    blockKey: null,
    itemId: null,
    courseId: null,
    label: `Focus for ${length} ${length === 1 ? 'min' : 'mins'}`,
    detail: null,
    minutes: length,
  };
}

export function sameTask(a: FocusTaskInfo | null, b: FocusTaskInfo | null): boolean {
  if (!a || !b) return false;
  return a.blockKey === b.blockKey && a.itemId === b.itemId && a.minutes === b.minutes && a.label === b.label;
}

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_FOCUS_MINUTES;
  return Math.min(MAX_SESSION_MINUTES, Math.max(1, Math.round(minutes)));
}

export function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "3:45 PM" in the student's time zone. */
export function formatClock(epochMs: number, timeZone: string | null | undefined): string {
  const zone = timeZone ?? 'UTC';
  try {
    let formatter = clockFormatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
      clockFormatters.set(zone, formatter);
    }
    return formatter.format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

// ---- hooks -------------------------------------------------------------------------------------------

const TICK_MS = 250;

/**
 * Wall-clock "now" for the countdown while `active`, refreshed a few times a second and the
 * moment the app returns to the foreground. Each refresh also lets the session timer catch up
 * (auto-advancing segments that ended), so transitions happen even after time in the background.
 */
export function useTimerClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      useFocusSession.getState().dispatch({ type: 'tick', now: current });
    };
    const interval = setInterval(tick, TICK_MS);
    const first = setTimeout(tick, 0);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      clearTimeout(first);
      subscription.remove();
    };
  }, [active]);

  return now;
}

const KEEP_AWAKE_TAG = 'termwise-focus';

/** Mounted only while the timer runs: keeps the screen on. */
export function KeepScreenAwake() {
  useKeepAwake(KEEP_AWAKE_TAG);
  return null;
}
