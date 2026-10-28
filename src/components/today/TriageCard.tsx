import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, CourseTag, Icon, InkProvider, inkForFill, NBText, Tag } from '@/components/ui';
import { courseName } from '@/components/plan/labels';
import { TRIAGE_REASON_LABEL } from '@/data/plan-views';
import type { EngineCourse, TriageAction } from '@/engine';
import { formatMinutes } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme, type AccentColor } from '@/theme';

const REASON_TONE: Record<TriageAction['reason'], AccentColor> = {
  overdue: 'red',
  due_today: 'orange',
  due_soon: 'yellow',
  planned_today: 'blue',
  high_impact: 'purple',
  red_zone_prep: 'pink',
};

export interface TriageCardProps {
  action: TriageAction;
  /** 1-based rank. */
  rank: number;
  course: EngineCourse | undefined;
  /** Checked off (optimistically) — the card stays put, struck through, until the plan refreshes. */
  done: boolean;
  busy: boolean;
  /** Absent when a focus session makes no sense (e.g. "add your score"). */
  onStartFocus?: () => void;
  /** Marks the block (or the item) done. */
  onDone?: () => void;
  doneLabel: string;
  onOpen: () => void;
}

/** One of today's top 3: a big rank stamp, the concrete step, minutes, course and why it's here. */
export function TriageCard({
  action,
  rank,
  course,
  done,
  busy,
  onStartFocus,
  onDone,
  doneLabel,
  onOpen,
}: TriageCardProps) {
  const theme = useTheme();
  const { colors, borders, spacing } = theme;
  const reason = TRIAGE_REASON_LABEL[action.reason];
  const minutes = formatMinutes(action.minutes);
  const spoken = `Number ${rank}: ${action.title}. ${action.subtitle}. About ${minutes}. ${reason}.${done ? ' Done.' : ''}`;

  return (
    <Card shadow={done ? 'sm' : rank === 1 ? 'lg' : 'md'} style={{ gap: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens the assignment"
        onPress={() => {
          haptic('selection');
          onOpen();
        }}
        style={({ pressed }) => [styles.top, { gap: spacing.md, opacity: pressed ? 0.75 : 1 }]}
      >
        <InkProvider value={inkForFill(done ? 'accent' : 'ink', colors)}>
          <View
            style={[
              styles.rank,
              {
                backgroundColor: done ? colors.green : colors.ink,
                borderColor: colors.border,
                borderWidth: borders.standard,
              },
            ]}
          >
            {done ? (
              <Icon name="checkmark" fallback="✓" size={26} weight="heavy" />
            ) : (
              <NBText variant="h1" accessible={false} maxFontSizeMultiplier={1.2}>
                {String(rank)}
              </NBText>
            )}
          </View>
        </InkProvider>
        <View style={[styles.grow, { gap: spacing.xs }]}>
          <View style={[styles.tags, { gap: spacing.xs }]}>
            {course ? <CourseTag course={course} /> : null}
            <Tag label={done ? 'Done' : reason} color={done ? 'green' : REASON_TONE[action.reason]} />
          </View>
          <NBText
            variant="h3"
            color={done ? 'muted' : undefined}
            style={done ? styles.struck : null}
            numberOfLines={3}
          >
            {action.title}
          </NBText>
          <NBText variant="small" color="muted" numberOfLines={2}>
            {action.subtitle}
          </NBText>
          <View style={[styles.minutes, { gap: spacing.xs }]}>
            <Icon name="clock" fallback="◷" size={14} color={colors.ink} />
            <NBText variant="smallBold" dense>
              {minutes}
            </NBText>
          </View>
        </View>
        <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} />
      </Pressable>
      {done ? null : (
        <View style={[styles.actions, { gap: spacing.sm }]}>
          {onStartFocus ? (
            <Button
              label="Start focus"
              size="sm"
              icon={{ name: 'timer', fallback: '◷' }}
              accessibilityHint={`Starts a focus timer for ${courseName(course)}`}
              onPress={onStartFocus}
            />
          ) : null}
          {onDone ? (
            <Button
              label={doneLabel}
              variant="secondary"
              size="sm"
              icon={{ name: 'checkmark', fallback: '✓' }}
              loading={busy}
              onPress={onDone}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  rank: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
  grow: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  minutes: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
});
