import { StyleSheet, View } from 'react-native';

import { Card, Icon, NBText, Tag } from '@/components/ui';
import { formatMinutes } from '@/lib/dates';
import { segmentName, type TimerState } from '@/lib/focus-timer';
import { useTheme } from '@/theme';

export interface SegmentListProps {
  timer: TimerState;
}

type Phase = 'done' | 'now' | 'next' | 'later';

const PHASE_WORD: Record<Phase, string> = { done: 'Done', now: 'Now', next: 'Up next', later: '' };

/** Every focus segment and break of the session, with where the student is. */
export function SegmentList({ timer }: SegmentListProps) {
  const { colors, borders, spacing } = useTheme();
  const finished = timer.status === 'finished';
  const focusNumbers: number[] = [];
  let count = 0;
  for (const segment of timer.segments) {
    if (segment.kind === 'focus') count += 1;
    focusNumbers.push(count);
  }

  return (
    <Card shadow="sm" padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
      <NBText variant="label" color="muted" style={{ paddingVertical: spacing.xs }}>
        {`Session plan · ${timer.segments.length} ${timer.segments.length === 1 ? 'segment' : 'segments'}`}
      </NBText>
      {timer.segments.map((segment, index) => {
        const phase: Phase =
          index < timer.index || (finished && index === timer.index && timer.completed)
            ? 'done'
            : index === timer.index && !finished
              ? 'now'
              : index === timer.index + 1 && !finished
                ? 'next'
                : 'later';
        const name = segment.kind === 'focus' ? `${segmentName(segment)} ${focusNumbers[index]}` : segmentName(segment);
        const word = PHASE_WORD[phase];
        return (
          <View
            key={`${segment.kind}:${index}`}
            accessible
            accessibilityLabel={`${name}, ${formatMinutes(segment.minutes)}${word ? `, ${word.toLowerCase()}` : ''}`}
            style={[
              styles.row,
              {
                gap: spacing.md,
                paddingVertical: spacing.sm,
                borderTopWidth: borders.hairline,
                borderTopColor: colors.border,
                opacity: phase === 'done' ? 0.65 : 1,
              },
            ]}
          >
            <View style={styles.icon}>
              {phase === 'done' ? (
                <Icon name="checkmark.circle.fill" fallback="✓" size={18} />
              ) : phase === 'now' ? (
                <Icon name="play.fill" fallback="▶" size={16} />
              ) : segment.kind === 'focus' ? (
                <Icon name="circle" fallback="○" size={16} color={colors.inkMuted} />
              ) : (
                <Icon name="cup.and.saucer" fallback="☕" size={16} color={colors.inkMuted} />
              )}
            </View>
            <NBText variant={phase === 'now' ? 'bodyBold' : 'body'} style={styles.grow} dense>
              {name}
            </NBText>
            <NBText variant="smallBold" color={phase === 'now' ? undefined : 'muted'} dense>
              {formatMinutes(segment.minutes)}
            </NBText>
            {phase === 'now' ? <Tag label="Now" color="yellow" /> : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  icon: { width: 22, alignItems: 'center' },
  grow: { flex: 1 },
});
