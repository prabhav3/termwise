import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { Icon } from './Icon';
import { NBText } from './NBText';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Leading accessory, e.g. a CourseDot or Icon. */
  left?: ReactNode;
  /** Trailing accessory, e.g. a Badge, Toggle or value text. */
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  destructive?: boolean;
  /** Draws the hairline divider above this row (for rows after the first inside a Card). */
  divider?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  chevron,
  onPress,
  destructive,
  divider,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ListRowProps) {
  const { colors, borders, spacing } = useTheme();
  const showChevron = chevron ?? onPress !== undefined;

  const content = (
    <>
      {left ? <View style={styles.side}>{left}</View> : null}
      <View style={styles.text}>
        <NBText variant="bodyBold" color={destructive ? 'red' : undefined} dense numberOfLines={2}>
          {title}
        </NBText>
        {subtitle ? (
          <NBText variant="small" color="muted" dense numberOfLines={2}>
            {subtitle}
          </NBText>
        ) : null}
      </View>
      {right ? <View style={styles.side}>{right}</View> : null}
      {showChevron ? <Icon name="chevron.right" fallback={'›'} size={14} color={colors.inkMuted} /> : null}
    </>
  );

  const rowStyle: ViewStyle = {
    minHeight: 56,
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: divider ? borders.hairline : 0,
    borderTopColor: colors.border,
  };

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={[styles.row, rowStyle, style]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [styles.row, rowStyle, pressed ? { backgroundColor: colors.surfaceAlt } : null, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
