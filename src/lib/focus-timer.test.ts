import { beforeEach, describe, expect, it } from 'vitest';

import { pomodoroCycles } from '@/engine';

import {
  advance,
  createTimer,
  currentSegment,
  focusedMinutes,
  focusedMs,
  focusPosition,
  formatCountdown,
  isInProgress,
  plannedFocusMinutes,
  reduceTimer,
  remainingMs,
  segmentEndAlert,
  segmentEndsAt,
  segmentProgress,
  spokenDuration,
  useFocusSession,
  type TimerSegment,
  type TimerState,
} from './focus-timer';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

const TWO_ROUNDS: TimerSegment[] = [
  { kind: 'focus', minutes: 25 },
  { kind: 'short_break', minutes: 5 },
  { kind: 'focus', minutes: 10 },
];

function run(state: TimerState, ...events: Parameters<typeof reduceTimer>[1][]): TimerState {
  return events.reduce(reduceTimer, state);
}

describe('createTimer', () => {
  it('starts ready on the first segment with nothing banked', () => {
    const timer = createTimer(TWO_ROUNDS);
    expect(timer.status).toBe('ready');
    expect(timer.index).toBe(0);
    expect(remainingMs(timer, T0)).toBe(25 * MIN);
    expect(segmentEndsAt(timer)).toBeNull();
    expect(focusedMs(timer, T0)).toBe(0);
    expect(isInProgress(timer)).toBe(false);
  });

  it('drops empty segments and is finished when nothing is left', () => {
    expect(createTimer([{ kind: 'focus', minutes: 0 }]).status).toBe('finished');
    expect(createTimer([]).segments).toHaveLength(0);
  });

  it('lays out the engine pomodoro cycles as given', () => {
    const timer = createTimer(pomodoroCycles(60, 25, 5));
    expect(timer.segments.map((s) => s.kind)).toEqual(['focus', 'short_break', 'focus', 'short_break', 'focus']);
    expect(plannedFocusMinutes(timer.segments)).toBe(60);
  });
});

describe('running, pausing and resuming', () => {
  it('counts down from wall-clock timestamps, not ticks', () => {
    const timer = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 });
    expect(timer.status).toBe('running');
    expect(timer.startedAt).toBe(T0);
    expect(segmentEndsAt(timer)).toBe(T0 + 25 * MIN);
    // No tick for 10 minutes (app in the background): the remaining time is still right.
    expect(remainingMs(timer, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(segmentProgress(timer, T0 + 10 * MIN)).toBeCloseTo(0.4);
    expect(isInProgress(timer)).toBe(true);
  });

  it('banks elapsed time on pause and keeps it across resume', () => {
    const paused = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 }, { type: 'pause', now: T0 + 5 * MIN });
    expect(paused.status).toBe('paused');
    // Time passing while paused does not count.
    expect(remainingMs(paused, T0 + 60 * MIN)).toBe(20 * MIN);
    expect(focusedMs(paused, T0 + 60 * MIN)).toBe(5 * MIN);

    const resumed = reduceTimer(paused, { type: 'start', now: T0 + 30 * MIN });
    expect(resumed.status).toBe('running');
    expect(resumed.startedAt).toBe(T0);
    expect(segmentEndsAt(resumed)).toBe(T0 + 50 * MIN);
    expect(remainingMs(resumed, T0 + 40 * MIN)).toBe(10 * MIN);
  });

  it('ignores events that do not apply', () => {
    const ready = createTimer(TWO_ROUNDS);
    expect(reduceTimer(ready, { type: 'pause', now: T0 })).toBe(ready);
    expect(reduceTimer(ready, { type: 'skip_break', now: T0 })).toBe(ready);
    const running = reduceTimer(ready, { type: 'start', now: T0 });
    expect(reduceTimer(running, { type: 'start', now: T0 + MIN })).toBe(running);
    expect(reduceTimer(running, { type: 'tick', now: T0 + MIN })).toBe(running);
  });
});

describe('segment transitions', () => {
  it('rolls focus straight into its break at the exact end time', () => {
    const running = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 });
    const onBreak = reduceTimer(running, { type: 'tick', now: T0 + 26 * MIN });
    expect(onBreak.index).toBe(1);
    expect(onBreak.status).toBe('running');
    expect(onBreak.runningSince).toBe(T0 + 25 * MIN);
    expect(remainingMs(onBreak, T0 + 26 * MIN)).toBe(4 * MIN);
    expect(focusedMs(onBreak, T0 + 26 * MIN)).toBe(25 * MIN);
    expect(focusPosition(onBreak)).toEqual({ number: 2, total: 2 });
  });

  it('waits for the student after a break, even after a long time away', () => {
    const running = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 });
    const back = reduceTimer(running, { type: 'tick', now: T0 + 3 * 60 * MIN });
    expect(back.index).toBe(2);
    expect(back.status).toBe('ready');
    expect(currentSegment(back)?.kind).toBe('focus');
    expect(remainingMs(back, T0 + 3 * 60 * MIN)).toBe(10 * MIN);
    // Only the focus that actually ran is counted.
    expect(focusedMinutes(back, T0 + 3 * 60 * MIN)).toBe(25);
  });

  it('finishes completed when the last segment runs out', () => {
    const lastFocus = run(
      createTimer(TWO_ROUNDS),
      { type: 'start', now: T0 },
      { type: 'tick', now: T0 + 31 * MIN },
      { type: 'start', now: T0 + 32 * MIN },
    );
    expect(lastFocus.status).toBe('running');
    const done = reduceTimer(lastFocus, { type: 'tick', now: T0 + 50 * MIN });
    expect(done.status).toBe('finished');
    expect(done.completed).toBe(true);
    expect(done.finishedAt).toBe(T0 + 42 * MIN);
    expect(focusedMinutes(done, T0 + 50 * MIN)).toBe(35);
    expect(remainingMs(done, T0 + 50 * MIN)).toBe(0);
    expect(isInProgress(done)).toBe(false);
  });

  it('advance() is a no-op unless a running segment has ended', () => {
    const running = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 });
    expect(advance(running, T0 + MIN)).toBe(running);
    const paused = reduceTimer(running, { type: 'pause', now: T0 + MIN });
    expect(advance(paused, T0 + 100 * MIN)).toBe(paused);
  });
});

describe('skip break and finish', () => {
  it('skips a break straight into the next focus', () => {
    const onBreak = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 }, { type: 'tick', now: T0 + 26 * MIN });
    const skipped = reduceTimer(onBreak, { type: 'skip_break', now: T0 + 27 * MIN });
    expect(skipped.index).toBe(2);
    expect(skipped.status).toBe('running');
    expect(segmentEndsAt(skipped)).toBe(T0 + 37 * MIN);
  });

  it('does not skip a focus segment', () => {
    const running = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 });
    expect(reduceTimer(running, { type: 'skip_break', now: T0 + MIN })).toBe(running);
  });

  it('finishing early banks the focus so far and is not completed', () => {
    const finished = run(createTimer(TWO_ROUNDS), { type: 'start', now: T0 }, { type: 'finish', now: T0 + 12 * MIN });
    expect(finished.status).toBe('finished');
    expect(finished.completed).toBe(false);
    expect(finished.finishedAt).toBe(T0 + 12 * MIN);
    expect(focusedMinutes(finished, T0 + 99 * MIN)).toBe(12);
    // Finishing again changes nothing.
    expect(reduceTimer(finished, { type: 'finish', now: T0 + 13 * MIN })).toBe(finished);
  });

  it('finishing during a break counts no break time as focus', () => {
    const finished = run(
      createTimer(TWO_ROUNDS),
      { type: 'start', now: T0 },
      { type: 'tick', now: T0 + 27 * MIN },
      { type: 'finish', now: T0 + 28 * MIN },
    );
    expect(focusedMinutes(finished, T0 + 28 * MIN)).toBe(25);
  });

  it('catches up before finishing, so a session that already ended is completed', () => {
    const single = run(createTimer([{ kind: 'focus', minutes: 25 }]), { type: 'start', now: T0 });
    const finished = reduceTimer(single, { type: 'finish', now: T0 + 40 * MIN });
    expect(finished.completed).toBe(true);
    expect(finished.finishedAt).toBe(T0 + 25 * MIN);
  });
});

describe('copy', () => {
  it('formats the countdown, rounding up to whole seconds', () => {
    expect(formatCountdown(25 * MIN)).toBe('25:00');
    expect(formatCountdown(61_001)).toBe('1:02');
    expect(formatCountdown(999)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65 * MIN)).toBe('1:05:00');
    expect(spokenDuration(12 * MIN + 5_000)).toBe('12 minutes 5 seconds');
    expect(spokenDuration(MIN)).toBe('1 minute');
    expect(spokenDuration(0)).toBe('0 seconds');
  });

  it('describes what happens when the running segment ends', () => {
    const task = 'Study 35 mins for PSY 101 Quiz 1';
    const ready = createTimer(TWO_ROUNDS);
    expect(segmentEndAlert(ready, task)).toBeNull();
    const focus = reduceTimer(ready, { type: 'start', now: T0 });
    expect(segmentEndAlert(focus, task)?.title).toBe('Focus done — take 5 min');
    const onBreak = reduceTimer(focus, { type: 'tick', now: T0 + 25 * MIN });
    expect(segmentEndAlert(onBreak, task)).toEqual({ title: "Break's over", body: `Ready for focus 2 of 2: ${task}` });
    const last = run(onBreak, { type: 'skip_break', now: T0 + 26 * MIN });
    expect(segmentEndAlert(last, task)?.title).toBe('Session complete');
  });
});

describe('useFocusSession store', () => {
  beforeEach(() => useFocusSession.getState().clear());

  const task = {
    blockKey: 'item-1:study:0',
    itemId: 'item-1',
    courseId: 'course-1',
    label: 'Study 35 mins for PSY 101 Quiz 1',
    detail: 'Study for Quiz 1 — 35 min',
    minutes: 35,
  };

  it('loads a task and drives the timer through dispatch', () => {
    const store = useFocusSession.getState();
    store.begin(task, TWO_ROUNDS);
    store.dispatch({ type: 'start', now: T0 });
    store.setSessionId('session-1');
    const state = useFocusSession.getState();
    expect(state.task).toEqual(task);
    expect(state.timer?.status).toBe('running');
    expect(state.sessionId).toBe('session-1');
    expect(state.logged).toBe(false);
  });

  it('keeps the same state object when an event changes nothing', () => {
    const store = useFocusSession.getState();
    store.begin(task, TWO_ROUNDS);
    store.dispatch({ type: 'start', now: T0 });
    const before = useFocusSession.getState().timer;
    store.dispatch({ type: 'tick', now: T0 + MIN });
    expect(useFocusSession.getState().timer).toBe(before);
  });

  it('begin replaces the previous session and clear empties it', () => {
    const store = useFocusSession.getState();
    store.begin(task, TWO_ROUNDS);
    store.setSessionId('session-1');
    store.markLogged();
    store.begin({ ...task, blockKey: null, label: 'Focus session' }, [{ kind: 'focus', minutes: 25 }]);
    let state = useFocusSession.getState();
    expect(state.sessionId).toBeNull();
    expect(state.logged).toBe(false);
    expect(state.timer?.segments).toHaveLength(1);
    state.clear();
    state = useFocusSession.getState();
    expect(state.task).toBeNull();
    expect(state.timer).toBeNull();
    // Dispatch without a timer is ignored.
    state.dispatch({ type: 'start', now: T0 });
    expect(useFocusSession.getState().timer).toBeNull();
  });
});
