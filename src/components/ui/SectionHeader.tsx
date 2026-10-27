import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { NBText } from './NBText';

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, actionLabel, onAction, style }: SectionHeaderProps) {
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { marginTop: spacing.xl, marginBottom: spacing.sm }, style]}>
      <NBText variant="h3" style={styles.title}>
        {title}
      </NBText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={12} onPress={onAction}>
          <NBText variant="smallBold" color="primary">
            {actionLabel}
          </NBText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Hairline ink rule. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors, borders } = useTheme();
  return <View accessible={false} style={[{ height: borders.hairline, backgroundColor: colors.border }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  title: { flex: 1 },
});
