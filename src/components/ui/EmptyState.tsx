import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type AccentColor } from '@/theme';

import { Button } from './Button';
import { NBText } from './NBText';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Color of the front block in the illustration. */
  tone?: AccentColor;
  style?: StyleProp<ViewStyle>;
}

const STACK: ReadonlyArray<{ tone: AccentColor; rotate: string; x: number; y: number }> = [
  { tone: 'blue', rotate: '-8deg', x: -18, y: 10 },
  { tone: 'pink', rotate: '6deg', x: 18, y: 4 },
];

/** A stack of chunky paper blocks (no emoji) above a short message and one action. */
export function EmptyState({ title, message, actionLabel, onAction, tone = 'yellow', style }: EmptyStateProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing } = theme;

  const block = (key: string, fill: string, extra: ViewStyle) => (
    <View
      key={key}
      style={[
        styles.block,
        {
          backgroundColor: fill,
          borderColor: colors.border,
          borderWidth: borders.standard,
          borderRadius: radius.control,
        },
        theme.shadow('md'),
        extra,
      ]}
    />
  );

  return (
    <View style={[styles.root, { gap: spacing.md, paddingVertical: spacing.xl }, style]}>
      <View accessible={false} style={styles.art}>
        {STACK.map((sheet) =>
          block(sheet.tone, colors[sheet.tone], {
            position: 'absolute',
            transform: [{ translateX: sheet.x }, { translateY: sheet.y }, { rotate: sheet.rotate }],
          }),
        )}
        <View
          style={[
            styles.block,
            styles.front,
            {
              backgroundColor: colors[tone],
              borderColor: colors.border,
              borderWidth: borders.standard,
              borderRadius: radius.control,
              gap: 6,
              padding: spacing.md,
            },
            theme.shadow('md'),
          ]}
        >
          {[0.9, 0.65, 0.8].map((width) => (
            <View key={width} style={{ height: 8, width: `${width * 100}%`, backgroundColor: colors.onAccent }} />
          ))}
        </View>
      </View>
      <NBText variant="h2" align="center">
        {title}
      </NBText>
      <NBText variant="body" color="muted" align="center" style={styles.message}>
        {message}
      </NBText>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ alignSelf: 'center', marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  art: { width: 160, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  block: { width: 104, height: 80 },
  front: { justifyContent: 'center' },
  message: { maxWidth: 320 },
});
