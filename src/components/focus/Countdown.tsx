import { StyleSheet, View } from 'react-native';

import { Card, NBText, ProgressBar, Tag } from '@/components/ui';
import {
  currentSegment,
  focusPosition,
  formatCountdown,
  plannedFocusMinutes,
  remainingMs,
  segmentEndsAt,
  segmentName,
  segmentProgress,
  spokenDuration,
  type TimerState,
} from '@/lib/focus-timer';
import { formatMinutes } from '@/lib/dates';
import { useTheme, type AccentColor } from '@/theme';

import { formatClock } from './session';

export interface CountdownProps {
  timer: TimerState;
  now: number;
  timeZone: string | null | undefined;
}

const FILL: Record<'focus' | 'short_break' | 'long_break', AccentColor> = {
  focus: 'yellow',
  short_break: 'green',
  long_break: 'blue',
};

function statusLine(timer: TimerState, timeZone: string | null | undefined): string {
  const endsAt = segmentEndsAt(timer);
  switch (timer.status) {
    case 'running':
      return endsAt ? `Ends at ${formatClock(endsAt, timeZone)}` : '';
    case 'paused':
      return 'Paused. Pick it back up when you’re ready.';
    case 'ready':
      return timer.startedAt === null
        ? `${formatMinutes(plannedFocusMinutes(timer.segments))} of focus, breaks included as you go.`
        : 'Break’s over. Start when you’re ready.';
    case 'finished':
      return 'Session finished.';
  }
}

/** The big neo-brutal countdown for the current segment. */
export function Countdown({ timer, now, timeZone }: CountdownProps) {
  const { colors, spacing } = useTheme();
  const segment = currentSegment(timer);
  const kind = segment?.kind ?? 'focus';
  const remaining = remainingMs(timer, now);
  const position = focusPosition(timer);
  const name = segmentName(segment);
  const heading = kind === 'focus' ? `${name} ${position.number} of ${position.total}` : name;
  const status = timer.status === 'paused' ? 'Paused' : timer.status === 'ready' ? 'Ready' : null;

  return (
    <Card color={FILL[kind]} shadow="lg" style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="label" style={styles.grow} dense>
          {heading}
        </NBText>
        {status ? <Tag label={status} color={timer.status === 'paused' ? 'orange' : 'pink'} /> : null}
      </View>
      <NBText
        accessibilityRole="timer"
        accessibilityLabel={`${spokenDuration(remaining)} left in ${heading.toLowerCase()}${status ? `, ${status.toLowerCase()}` : ''}`}
        variant="number"
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.2}
        style={styles.digits}
      >
        {formatCountdown(remaining)}
      </NBText>
      <ProgressBar value={segmentProgress(timer, now)} label={`${heading} progress`} color={colors.ink} height={20} />
      <NBText variant="bodyMedium" align="center">
        {statusLine(timer, timeZone)}
      </NBText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
  digits: { fontSize: 88, lineHeight: 100, fontVariant: ['tabular-nums'] },
});
