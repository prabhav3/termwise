// Pomodoro timer for the Focus screen.
//
// The timer is timestamp-based: it stores when the current stretch started, never a ticking
// counter, so backgrounding, a locked phone or a dropped interval never loses time. Every
// transition is a pure function of (state, now) — unit-tested in focus-timer.test.ts — and a
// small zustand store keeps the live session outside the screen, so it survives the modal
// unmounting and re-renders.
//
// Flow: focus segments end into their break automatically (the break starts at the exact moment
// focus ended); a break ends into "ready" and waits for the student to start the next focus, so
// time away from the phone is never counted as focused time.
import { create } from 'zustand';

import type { PomodoroSegment } from '@/engine/types';

export type TimerSegment = PomodoroSegment;
export type TimerStatus = 'ready' | 'running' | 'paused' | 'finished';

export interface TimerState {
  segments: readonly TimerSegment[];
  /** Index of the current segment (stays on the last one once finished). */
  index: number;
  status: TimerStatus;
  /** Epoch ms the current running stretch began; null unless running. */
  runningSince: number | null;
  /** Time spent in the current segment before `runningSince` (banked across pauses). */
  segmentElapsedMs: number;
  /** Focus time from segments already left behind. */
  bankedFocusMs: number;
  /** Epoch ms of the first start; null until the student presses Start. */
  startedAt: number | null;
  finishedAt: number | null;
  /** True when every segment ran to its end (not finished early). */
  completed: boolean;
}

export type TimerEvent =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'skip_break'; now: number }
  | { type: 'finish'; now: number }
  | { type: 'tick'; now: number };

const MINUTE_MS = 60_000;

export function isBreak(segment: TimerSegment | undefined): boolean {
  return segment !== undefined && segment.kind !== 'focus';
}

export function segmentDurationMs(segment: TimerSegment | undefined): number {
  return segment ? Math.max(0, segment.minutes) * MINUTE_MS : 0;
}

/** A fresh timer waiting on its first segment. Zero-length segments are dropped. */
export function createTimer(segments: readonly TimerSegment[]): TimerState {
  const usable = segments.filter((segment) => segment.minutes > 0);
  return {
    segments: usable,
    index: 0,
    status: usable.length === 0 ? 'finished' : 'ready',
    runningSince: null,
    segmentElapsedMs: 0,
    bankedFocusMs: 0,
    startedAt: null,
    finishedAt: null,
    completed: false,
  };
}

export function currentSegment(state: TimerState): TimerSegment | undefined {
  return state.segments[state.index];
}

/** Time spent in the current segment at `now` (never more than its length). */
export function elapsedInSegment(state: TimerState, now: number): number {
  const running = state.status === 'running' && state.runningSince !== null ? Math.max(0, now - state.runningSince) : 0;
  return Math.min(segmentDurationMs(currentSegment(state)), state.segmentElapsedMs + running);
}

export function remainingMs(state: TimerState, now: number): number {
  if (state.status === 'finished') return 0;
  return Math.max(0, segmentDurationMs(currentSegment(state)) - elapsedInSegment(state, now));
}

/** Epoch ms the running segment ends; null unless running. */
export function segmentEndsAt(state: TimerState): number | null {
  if (state.status !== 'running' || state.runningSince === null) return null;
  return state.runningSince + segmentDurationMs(currentSegment(state)) - state.segmentElapsedMs;
}

/** 0..1 through the current segment. */
export function segmentProgress(state: TimerState, now: number): number {
  const total = segmentDurationMs(currentSegment(state));
  if (state.status === 'finished') return 1;
  return total > 0 ? elapsedInSegment(state, now) / total : 0;
}

/** Total focused time at `now`, including the focus segment in progress. */
export function focusedMs(state: TimerState, now: number): number {
  const inProgress = state.status !== 'finished' && currentSegment(state)?.kind === 'focus' ? elapsedInSegment(state, now) : 0;
  return state.bankedFocusMs + inProgress;
}

export function focusedMinutes(state: TimerState, now: number): number {
  return Math.round(focusedMs(state, now) / MINUTE_MS);
}

/** Planned focus minutes across the whole session. */
export function plannedFocusMinutes(segments: readonly TimerSegment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.kind === 'focus' ? segment.minutes : 0), 0);
}

/** 1-based position of the current focus segment (or the next one, during a break) and the total. */
export function focusPosition(state: TimerState): { number: number; total: number } {
  const total = state.segments.filter((segment) => segment.kind === 'focus').length;
  let number = 0;
  for (let i = 0; i <= state.index && i < state.segments.length; i++) {
    if (state.segments[i].kind === 'focus') number += 1;
  }
  if (isBreak(currentSegment(state))) number += 1;
  return { number: Math.min(Math.max(number, 1), Math.max(total, 1)), total };
}

/** Moves past every segment that ended while running (possibly several after a long background). */
export function advance(state: TimerState, now: number): TimerState {
  let next = state;
  for (;;) {
    const endsAt = segmentEndsAt(next);
    if (endsAt === null || now < endsAt) return next;
    const segment = currentSegment(next);
    const bankedFocusMs = next.bankedFocusMs + (segment?.kind === 'focus' ? segmentDurationMs(segment) : 0);
    const nextIndex = next.index + 1;
    if (nextIndex >= next.segments.length) {
      return {
        ...next,
        status: 'finished',
        runningSince: null,
        segmentElapsedMs: segmentDurationMs(segment),
        bankedFocusMs,
        finishedAt: endsAt,
        completed: true,
      };
    }
    // Breaks start the moment focus ends; focus waits for the student after a break.
    const breakNext = isBreak(next.segments[nextIndex]);
    next = {
      ...next,
      index: nextIndex,
      status: breakNext ? 'running' : 'ready',
      runningSince: breakNext ? endsAt : null,
      segmentElapsedMs: 0,
      bankedFocusMs,
    };
  }
}

function start(state: TimerState, now: number): TimerState {
  if (state.status !== 'ready' && state.status !== 'paused') return state;
  return { ...state, status: 'running', runningSince: now, startedAt: state.startedAt ?? now };
}

function pause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state;
  return { ...state, status: 'paused', runningSince: null, segmentElapsedMs: elapsedInSegment(state, now) };
}

function skipBreak(state: TimerState, now: number): TimerState {
  if (state.status === 'finished' || !isBreak(currentSegment(state))) return state;
  const nextIndex = state.index + 1;
  if (nextIndex >= state.segments.length) return finish(state, now);
  return {
    ...state,
    index: nextIndex,
    status: 'running',
    runningSince: now,
    segmentElapsedMs: 0,
    startedAt: state.startedAt ?? now,
  };
}

function finish(state: TimerState, now: number): TimerState {
  if (state.status === 'finished') return state;
  const elapsed = elapsedInSegment(state, now);
  const inFocus = currentSegment(state)?.kind === 'focus';
  return {
    ...state,
    status: 'finished',
    runningSince: null,
    segmentElapsedMs: elapsed,
    bankedFocusMs: state.bankedFocusMs + (inFocus ? elapsed : 0),
    finishedAt: now,
    completed: false,
  };
}

/** The timer's reducer. Every event first catches up on segments that ended in the meantime. */
export function reduceTimer(state: TimerState, event: TimerEvent): TimerState {
  const current = advance(state, event.now);
  switch (event.type) {
    case 'tick':
      return current;
    case 'start':
      return start(current, event.now);
    case 'pause':
      return pause(current, event.now);
    case 'skip_break':
      return skipBreak(current, event.now);
    case 'finish':
      return finish(current, event.now);
  }
}

// ---- copy (pure) ---------------------------------------------------------------------------

export function segmentName(segment: TimerSegment | undefined): string {
  if (!segment) return 'Session';
  switch (segment.kind) {
    case 'focus':
      return 'Focus';
    case 'short_break':
      return 'Short break';
    case 'long_break':
      return 'Long break';
  }
}

/** "24:59", "1:05:00" — always whole seconds, rounded up so 0:00 means done. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** "12 minutes 5 seconds" for VoiceOver. */
export function spokenDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/**
 * The local notification for the end of the running segment, or null when nothing is running.
 * `task` is the session label, e.g. "Study 25 mins for PSY 101 Quiz 1".
 */
export function segmentEndAlert(state: TimerState, task: string): { title: string; body: string } | null {
  if (state.status !== 'running') return null;
  const segment = currentSegment(state);
  const next = state.segments[state.index + 1];
  if (!segment) return null;
  if (segment.kind === 'focus') {
    if (!next) return { title: 'Session complete', body: `Nice work. ${task} — open Termwise to check it off.` };
    return { title: `Focus done — take ${next.minutes} min`, body: `${segmentName(next)} started. Stretch, water, eyes off the screen.` };
  }
  const position = focusPosition({ ...state, index: state.index + 1 });
  return {
    title: "Break's over",
    body: `Ready for focus ${position.number} of ${position.total}: ${task}`,
  };
}

// ---- live session store ------------------------------------------------------------------------

export interface FocusTaskInfo {
  /** Plan block this session works on, when it came from the plan. */
  blockKey: string | null;
  itemId: string | null;
  courseId: string | null;
  /** "Study 25 mins for PSY 101 Quiz 1" */
  label: string;
  /** The concrete step, e.g. "Read pp. 101–126 (Ch. 4)". */
  detail: string | null;
  /** Planned session length (focus minutes). */
  minutes: number;
}

export interface FocusSessionState {
  task: FocusTaskInfo | null;
  timer: TimerState | null;
  /** focus_sessions row id once the start was logged. */
  sessionId: string | null;
  /** The end of the session was written to focus_sessions. */
  logged: boolean;
  /** Loads a task, replacing whatever was loaded before. */
  begin: (task: FocusTaskInfo, segments: readonly TimerSegment[]) => void;
  dispatch: (event: TimerEvent) => void;
  setSessionId: (id: string | null) => void;
  markLogged: () => void;
  clear: () => void;
}

export const useFocusSession = create<FocusSessionState>()((set) => ({
  task: null,
  timer: null,
  sessionId: null,
  logged: false,
  begin: (task, segments) => set({ task, timer: createTimer(segments), sessionId: null, logged: false }),
  dispatch: (event) =>
    set((state) => {
      if (!state.timer) return state;
      const timer = reduceTimer(state.timer, event);
      return timer === state.timer ? state : { timer };
    }),
  setSessionId: (sessionId) => set({ sessionId }),
  markLogged: () => set({ logged: true }),
  clear: () => set({ task: null, timer: null, sessionId: null, logged: false }),
}));

/** A session the student has started and not finished. */
export function isInProgress(timer: TimerState | null): boolean {
  return timer !== null && timer.startedAt !== null && timer.status !== 'finished';
}
