import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, CourseTag, Icon, NBText } from '@/components/ui';
import type { EngineCourse, FocusTask } from '@/engine';
import { formatMinutes } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface TaskPickerProps {
  tasks: readonly FocusTask[];
  /** Concrete step for each block key, e.g. "Read pp. 101–126 (Ch. 4)". */
  details: Map<string, string>;
  courses: Map<string, EngineCourse>;
  focusMinutes: number;
  onPick: (task: FocusTask) => void;
  onFreeFocus: () => void;
}

/** "What do you want to focus on?" — today's planned blocks in triage order. */
export function TaskPicker({ tasks, details, courses, focusMinutes, onPick, onFreeFocus }: TaskPickerProps) {
  const { colors, borders, spacing } = useTheme();

  return (
    <View style={{ gap: spacing.lg }}>
      {tasks.length === 0 ? (
        <Card color="surfaceAlt" shadow="sm" style={{ gap: spacing.xs }}>
          <NBText variant="bodyBold">Nothing planned for today.</NBText>
          <NBText variant="small" color="muted">
            You can still run a timer for anything you want to get ahead on.
          </NBText>
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
          {tasks.map((task, index) => {
            const course = courses.get(task.course_id);
            const detail = details.get(task.block_key);
            return (
              <Pressable
                key={task.block_key}
                accessibilityRole="button"
                accessibilityLabel={`${task.label}${detail ? `. ${detail}` : ''}`}
                accessibilityHint="Loads this task into the timer"
                onPress={() => {
                  haptic('selection');
                  onPick(task);
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    gap: spacing.md,
                    paddingVertical: spacing.md,
                    borderTopWidth: index > 0 ? borders.hairline : 0,
                    borderTopColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.grow, { gap: spacing.xs }]}>
                  <NBText variant="bodyBold" numberOfLines={2}>
                    {task.label}
                  </NBText>
                  <View style={[styles.meta, { gap: spacing.sm }]}>
                    {course ? <CourseTag course={course} /> : null}
                    {detail ? (
                      <NBText variant="tiny" color="muted" numberOfLines={1} style={styles.shrink} dense>
                        {detail}
                      </NBText>
                    ) : null}
                  </View>
                </View>
                <NBText variant="smallBold" dense>
                  {formatMinutes(task.minutes)}
                </NBText>
                <Icon name="play.circle.fill" fallback="▶" size={26} color={colors.primary} />
              </Pressable>
            );
          })}
        </Card>
      )}
      <Button
        label={`Just focus · ${formatMinutes(focusMinutes)}`}
        variant="secondary"
        icon={{ name: 'timer', fallback: '◷' }}
        fullWidth
        onPress={onFreeFocus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'center' },
});
