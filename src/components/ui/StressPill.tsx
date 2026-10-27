import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { StressLevel } from '@/engine/types';
import { useTheme } from '@/theme';

import { Icon } from './Icon';
import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

const LEVEL_WORD: Record<StressLevel, string> = {
  calm: 'Calm',
  busy: 'Busy',
  heavy: 'Heavy',
  red: 'Red zone',
};

export function stressLabel(level: StressLevel): string {
  return LEVEL_WORD[level];
}

export interface StressPillProps {
  level: StressLevel;
  score: number;
  /** Score only (for tight rows); the level word is still spoken. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Stress score on its level color. Red zones also get a warning glyph so color is never the only signal. */
export function StressPill({ level, score, compact = false, style }: StressPillProps) {
  const { colors, borders, radius, spacing, stressColors } = useTheme();
  const rounded = Math.round(score);
  const word = LEVEL_WORD[level];
  return (
    <InkProvider value={inkForFill('accent', colors)}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Stress ${rounded}, ${word.toLowerCase()}`}
        style={[
          styles.pill,
          {
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
            borderRadius: radius.pill,
            borderWidth: borders.hairline,
            borderColor: colors.border,
            backgroundColor: stressColors[level],
          },
          style,
        ]}
      >
        {level === 'red' ? <Icon name="exclamationmark.triangle.fill" fallback={'⚠'} size={14} /> : null}
        <NBText variant="smallBold" dense>
          {compact ? String(rounded) : `${rounded} · ${word.toUpperCase()}`}
        </NBText>
      </View>
    </InkProvider>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 28, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
});
