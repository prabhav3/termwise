import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, View } from 'react-native';

import { Countdown } from '@/components/focus/Countdown';
import { cancelSegmentAlerts, scheduleSegmentAlerts } from '@/components/focus/segment-alerts';
import { SegmentList } from '@/components/focus/SegmentList';
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  firstParam,
  freeTask,
  KeepScreenAwake,
  sameTask,
  segmentsFor,
  taskForBlock,
  taskForItem,
  taskFromQueue,
  useTimerClock,
} from '@/components/focus/session';
import { TaskPicker } from '@/components/focus/TaskPicker';
import {
  Button,
  Card,
  CourseTag,
  ErrorBanner,
  Icon,
  IconButton,
  LoadingBlock,
  NBText,
  Screen,
  Sheet,
  useToast,
} from '@/components/ui';
import { useBlock, useFinishFocusSession, useStartFocusSession } from '@/data';
import { courseIndex } from '@/data/plan-views';
import { focusQueue } from '@/engine';
import { useAuth } from '@/lib/auth';
import { formatMinutes } from '@/lib/dates';
import {
  currentSegment,
  focusedMinutes,
  focusPosition,
  isBreak,
  isInProgress,
  plannedFocusMinutes,
  reduceTimer,
  segmentName,
  upcomingAlerts,
  useFocusSession,
  type FocusTaskInfo,
  type TimerStatus,
} from '@/lib/focus-timer';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { getNotificationPermission, requestNotificationPermission, type NotificationPermission } from '@/lib/notifications';
import { useMarkBlockDone, usePlan } from '@/lib/planner';
import { useTheme } from '@/theme';

function leaveFocus() {
  void cancelSegmentAlerts();
  useFocusSession.getState().clear();
  if (router.canGoBack()) router.back();
  else router.replace('/' as Href);
}

export default function FocusScreen() {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ blockKey?: string; itemId?: string; minutes?: string }>();
  const view = usePlan();

  const task = useFocusSession((state) => state.task);
  const timer = useFocusSession((state) => state.timer);
  const sessionId = useFocusSession((state) => state.sessionId);
  const logged = useFocusSession((state) => state.logged);

  const { mutateAsync: logStart } = useStartFocusSession();
  const { mutate: logFinish } = useFinishFocusSession();
  const markDone = useMarkBlockDone();
  const storedBlock = useBlock(task?.blockKey);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  const focusMinutes = profile?.pomodoro_focus_minutes ?? DEFAULT_FOCUS_MINUTES;
  const breakMinutes = profile?.pomodoro_break_minutes ?? DEFAULT_BREAK_MINUTES;
  const plan = view.status === 'ready' ? view.plan : null;
  const courses = view.status === 'ready' ? view.courses : null;

  const blockKeyParam = firstParam(params.blockKey);
  const itemIdParam = firstParam(params.itemId);
  const minutesParam = Number(firstParam(params.minutes) ?? '');

  // What the link asked for: a task, null when it no longer exists, undefined when nothing was asked.
  const requested = useMemo<FocusTaskInfo | null | undefined>(() => {
    if (!plan || !courses) return undefined;
    if (blockKeyParam) return taskForBlock({ plan, courses }, blockKeyParam);
    if (itemIdParam) return taskForItem({ plan, courses }, itemIdParam, minutesParam > 0 ? minutesParam : focusMinutes);
    return undefined;
  }, [plan, courses, blockKeyParam, itemIdParam, minutesParam, focusMinutes]);

  // Load the requested task unless another session is mid-way (the student decides then).
  useEffect(() => {
    if (!requested) return;
    const state = useFocusSession.getState();
    if (sameTask(state.task, requested) || isInProgress(state.timer)) return;
    state.begin(requested, segmentsFor(requested.minutes, { focus: focusMinutes, shortBreak: breakMinutes }));
  }, [requested, focusMinutes, breakMinutes]);

  useEffect(() => {
    let active = true;
    void getNotificationPermission().then((answer) => {
      if (active) setPermission(answer);
    });
    return () => {
      active = false;
    };
  }, []);

  const running = timer?.status === 'running';
  const now = useTimerClock(running);

  // While running: alerts for the end of this segment (and of the break that follows it on its
  // own). Paused, ready or finished: none. Re-run once notification permission comes back.
  // `timer` keeps its identity between ticks, so this only reschedules on real transitions.
  const taskLabel = task?.label ?? null;
  const alerts = useMemo(() => (timer && taskLabel ? upcomingAlerts(timer, taskLabel) : []), [timer, taskLabel]);
  useEffect(() => {
    if (alerts.length > 0) void scheduleSegmentAlerts(alerts);
    else void cancelSegmentAlerts();
  }, [alerts, permission]);

  // Haptic + VoiceOver announcement whenever the segment changes or the session ends.
  const index = timer?.index ?? -1;
  const status: TimerStatus | null = timer?.status ?? null;
  const segmentText = timer ? segmentName(currentSegment(timer)) : '';
  const previous = useRef({ index, status, taskLabel });
  useEffect(() => {
    const before = previous.current;
    previous.current = { index, status, taskLabel };
    if (before.taskLabel !== taskLabel) return;
    if (status === 'finished' && before.status !== 'finished') {
      haptic('success');
      AccessibilityInfo.announceForAccessibility('Session finished.');
    } else if (index !== before.index && status !== null) {
      haptic('medium');
      AccessibilityInfo.announceForAccessibility(`${segmentText}${status === 'ready' ? '. Start when you are ready.' : ' started.'}`);
    }
  }, [index, status, taskLabel, segmentText]);

  // Close the focus_sessions row once the session ends (naturally or via Finish).
  useEffect(() => {
    if (!timer || timer.status !== 'finished' || !sessionId || logged) return;
    useFocusSession.getState().markLogged();
    logFinish({ id: sessionId, focusedMinutes: focusedMinutes(timer, timer.finishedAt ?? 0), completed: timer.completed });
  }, [timer, sessionId, logged, logFinish]);

  // ---- actions --------------------------------------------------------------------------------

  const startOrResume = () => {
    const state = useFocusSession.getState();
    if (!state.timer || !state.task) return;
    const first = state.timer.startedAt === null;
    state.dispatch({ type: 'start', now: Date.now() });
    haptic('medium');
    if (!first) return;
    // Ask once, in context; the alert is scheduled as soon as the answer comes back.
    void requestNotificationPermission().then(setPermission);
    const startedTask = state.task;
    logStart({
      item_id: startedTask.itemId,
      plan_block_id: storedBlock.data?.id ?? null,
      planned_minutes: plannedFocusMinutes(state.timer.segments),
    })
      .then((row) => {
        const latest = useFocusSession.getState();
        if (latest.task === startedTask) latest.setSessionId(row.id);
        else logFinish({ id: row.id, focusedMinutes: 0, completed: false });
      })
      .catch(() =>
        toast.show({
          tone: 'warning',
          title: 'Session not saved',
          message: "The timer still works — this one just won't show in your focus history.",
        }),
      );
  };

  const dispatchNow = (type: 'pause' | 'skip_break' | 'finish') => {
    useFocusSession.getState().dispatch({ type, now: Date.now() });
    haptic(type === 'finish' ? 'light' : 'selection');
  };

  const switchTo = (next: FocusTaskInfo) => {
    const state = useFocusSession.getState();
    if (state.timer && state.sessionId && !state.logged) {
      const ended = reduceTimer(state.timer, { type: 'finish', now: Date.now() });
      logFinish({ id: state.sessionId, focusedMinutes: focusedMinutes(ended, 0), completed: false });
    }
    void cancelSegmentAlerts();
    state.begin(next, segmentsFor(next.minutes, { focus: focusMinutes, shortBreak: breakMinutes }));
  };

  const requestClose = () => {
    if (isInProgress(useFocusSession.getState().timer)) setConfirmEnd(true);
    else leaveFocus();
  };

  // Android back button: same as the close button.
  const onBack = useRef(requestClose);
  useEffect(() => {
    onBack.current = confirmEnd ? () => setConfirmEnd(false) : requestClose;
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const shownBlock = task?.blockKey ? plan?.blocks.find((block) => block.key === task.blockKey) : undefined;
  const blockStatus = shownBlock?.status;
  const canMarkDone = blockStatus === 'planned';

  const markBlockDone = () => {
    if (!shownBlock) return;
    markDone
      .mutateAsync(shownBlock)
      .then(() => {
        toast.show({ tone: 'success', title: 'Checked off', message: 'Nice work. Your plan is updated.' });
        leaveFocus();
      })
      .catch((error: unknown) => toast.show({ tone: 'danger', title: "Couldn't check it off", message: errorMessage(error) }));
  };

  // ---- render ---------------------------------------------------------------------------------

  const courseById = courses ? courseIndex(courses) : null;
  const course = task?.courseId ? courseById?.get(task.courseId) : undefined;
  const mismatch = requested && task && timer && !sameTask(task, requested) && isInProgress(timer) ? requested : null;
  const showPicker = !task && (requested === undefined || requested === null);

  const closeButton = <IconButton icon="xmark" fallback="✕" label="Close focus" onPress={requestClose} />;

  if (showPicker) {
    return (
      <Screen eyebrow="Focus" title="What's next?" headerRight={closeButton} edges={['top', 'bottom']}>
        {view.status === 'loading' ? (
          <LoadingBlock label="Loading today's plan" lines={4} />
        ) : view.status === 'error' ? (
          <ErrorBanner title="Your plan didn't load" message={view.error.message} onRetry={view.retry} />
        ) : (
          <View style={{ gap: spacing.lg }}>
            {requested === null ? (
              <ErrorBanner
                tone="warning"
                title="That block moved"
                message="It's not in your plan anymore (it may be done or rescheduled). Pick something from today instead."
              />
            ) : null}
            <TaskPicker
              tasks={focusQueue(view.plan, view.courses, view.today, focusMinutes)}
              details={new Map(view.plan.blocks.filter((block) => block.date === view.today).map((block) => [block.key, block.label]))}
              courses={courseIndex(view.courses)}
              focusMinutes={focusMinutes}
              onPick={(picked) => switchTo(taskFromQueue({ plan: view.plan, courses: view.courses }, picked))}
              onFreeFocus={() => switchTo(freeTask(focusMinutes))}
            />
          </View>
        )}
      </Screen>
    );
  }

  if (!task || !timer) {
    return (
      <Screen eyebrow="Focus" headerRight={closeButton}>
        <LoadingBlock label="Getting your session ready" lines={3} height={200} />
      </Screen>
    );
  }

  const finished = timer.status === 'finished';
  const started = timer.startedAt !== null;
  const onBreak = isBreak(currentSegment(timer));
  const position = focusPosition(timer);
  const focusedSoFar = focusedMinutes(timer, now);

  let footer: React.ReactNode;
  if (finished) {
    footer = canMarkDone ? (
      <View style={{ gap: spacing.sm }}>
        <Button label="Yes, mark it done" size="lg" fullWidth loading={markDone.isPending} onPress={markBlockDone} />
        <Button label="Not yet" variant="secondary" fullWidth onPress={leaveFocus} />
      </View>
    ) : (
      <Button label="Done" size="lg" fullWidth onPress={leaveFocus} />
    );
  } else {
    const primary =
      timer.status === 'running'
        ? onBreak
          ? { label: 'Skip break', icon: 'forward.fill' as const, fallback: '»', onPress: () => dispatchNow('skip_break') }
          : { label: 'Pause', icon: 'pause.fill' as const, fallback: '❚❚', onPress: () => dispatchNow('pause') }
        : timer.status === 'paused'
          ? { label: 'Resume', icon: 'play.fill' as const, fallback: '▶', onPress: startOrResume }
          : {
              label: started ? `Start focus ${position.number} of ${position.total}` : 'Start focus',
              icon: 'play.fill' as const,
              fallback: '▶',
              onPress: startOrResume,
            };
    footer = (
      <View style={{ gap: spacing.sm }}>
        <Button
          label={primary.label}
          size="lg"
          fullWidth
          icon={{ name: primary.icon, fallback: primary.fallback }}
          onPress={primary.onPress}
        />
        {started ? (
          <View style={[styles.row, { gap: spacing.sm }]}>
            {timer.status === 'running' && onBreak ? (
              <Button label="Pause" variant="secondary" style={styles.grow} onPress={() => dispatchNow('pause')} />
            ) : null}
            <Button
              label="Finish"
              variant="secondary"
              style={styles.grow}
              accessibilityHint="Ends the session now and saves the time you focused"
              onPress={() => dispatchNow('finish')}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen eyebrow="Focus" headerRight={closeButton} footer={footer}>
      {running ? <KeepScreenAwake /> : null}
      <View style={{ gap: spacing.lg }}>
        {mismatch ? (
          <Card color="surfaceAlt" shadow="sm" style={{ gap: spacing.sm }}>
            <NBText variant="bodyBold">You&apos;re mid-session.</NBText>
            <NBText variant="small">{`Finish this one first, or switch to “${mismatch.label}”.`}</NBText>
            <Button label="Switch to it" variant="secondary" size="sm" onPress={() => switchTo(mismatch)} />
          </Card>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          {course ? <CourseTag course={course} /> : null}
          <NBText variant="h2">{task.label}</NBText>
          {task.detail && task.detail !== task.label ? (
            <NBText variant="body" color="muted">
              {task.detail}
            </NBText>
          ) : null}
        </View>

        {finished ? (
          <Card color="green" shadow="lg" style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Icon name="checkmark.seal.fill" fallback="✓" size={28} />
              <NBText variant="h1" style={styles.grow}>
                {timer.completed ? 'Session complete' : 'Session ended'}
              </NBText>
            </View>
            <NBText variant="bodyMedium">
              {focusedSoFar > 0
                ? `You focused for ${formatMinutes(focusedSoFar)}. That counts.`
                : 'Short one — that still counts as showing up.'}
            </NBText>
            {canMarkDone ? (
              <>
                <NBText variant="h3" style={{ marginTop: spacing.sm }}>
                  Mark this block done?
                </NBText>
                <NBText variant="small">Checking it off updates the rest of your plan.</NBText>
              </>
            ) : blockStatus === 'done' ? (
              <NBText variant="small">This block is already checked off.</NBText>
            ) : null}
          </Card>
        ) : (
          <>
            <Countdown timer={timer} now={now} timeZone={profile?.timezone} />
            {started ? (
              <NBText variant="smallBold" color="muted" align="center">
                {`Focused ${formatMinutes(focusedSoFar)} so far`}
              </NBText>
            ) : null}
          </>
        )}

        <SegmentList timer={timer} />
      </View>

      <Sheet
        visible={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End this session?"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button
              label="End session"
              variant="danger"
              fullWidth
              onPress={() => {
                setConfirmEnd(false);
                dispatchNow('finish');
              }}
            />
            <Button label="Keep going" variant="secondary" fullWidth onPress={() => setConfirmEnd(false)} />
          </View>
        }
      >
        <NBText variant="body">
          {focusedSoFar > 0
            ? `You've focused ${formatMinutes(focusedSoFar)}. Ending now saves that time.`
            : "You haven't focused yet. Ending now just closes the timer."}
        </NBText>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
});
