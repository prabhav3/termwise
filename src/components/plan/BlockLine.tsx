import { Pressable, StyleSheet, View } from 'react-native';

import { CourseTag, Icon, NBText } from '@/components/ui';
import type { EngineBlock, EngineCourse } from '@/engine';
import { formatMinutes } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { BLOCK_KIND_ICON, BLOCK_KIND_LABEL, BLOCK_STATUS_LABEL, courseName } from './labels';

export interface BlockLineProps {
  block: EngineBlock;
  course: EngineCourse | undefined;
  onPress?: () => void;
  divider?: boolean;
}

/** One planned block in a read-only list (week detail): label, course, minutes, status in words. */
export function BlockLine({ block, course, onPress, divider }: BlockLineProps) {
  const { colors, borders, spacing } = useTheme();
  const settled = block.status !== 'planned';
  const icon = BLOCK_KIND_ICON[block.kind];
  const status = BLOCK_STATUS_LABEL[block.status];
  const spoken = `${block.label}. ${courseName(course)}. ${formatMinutes(block.minutes)}. ${status}.`;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={spoken}
      accessibilityHint={onPress ? 'Opens the assignment' : undefined}
      disabled={!onPress}
      onPress={() => {
        haptic('selection');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.md,
          paddingVertical: spacing.sm,
          borderTopWidth: divider ? borders.hairline : 0,
          borderTopColor: colors.border,
          backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={[styles.icon, { opacity: settled ? 0.6 : 1 }]}>
        <Icon
          name={block.status === 'done' ? 'checkmark.circle.fill' : icon.name}
          fallback={block.status === 'done' ? '✓' : icon.fallback}
          size={18}
        />
      </View>
      <View style={[styles.text, { gap: 2 }]}>
        <NBText
          variant="bodyMedium"
          color={settled ? 'muted' : undefined}
          style={settled ? styles.struck : null}
          numberOfLines={2}
          dense
        >
          {block.label}
        </NBText>
        <View style={[styles.meta, { gap: spacing.sm }]}>
          {course ? <CourseTag course={course} /> : null}
          <NBText variant="tiny" color="muted" dense>
            {`${BLOCK_KIND_LABEL[block.kind]} · ${formatMinutes(block.minutes)}${settled ? ` · ${status}` : ''}`}
          </NBText>
        </View>
      </View>
      {onPress ? <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  icon: { width: 24, alignItems: 'center' },
  text: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
});
