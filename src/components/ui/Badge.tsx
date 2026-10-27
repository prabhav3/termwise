import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type AccentColor } from '@/theme';

import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

export interface BadgeProps {
  label: string;
  tone?: AccentColor | 'ink';
  /** Spoken text, e.g. "3 open discrepancies" for a badge reading "3". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'red', accessibilityLabel, style }: BadgeProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const isInk = tone === 'ink';
  return (
    <InkProvider value={inkForFill(isInk ? 'ink' : 'accent', colors)}>
      <View
        accessible
        accessibilityLabel={accessibilityLabel ?? label}
        style={[
          {
            minWidth: 24,
            height: 24,
            paddingHorizontal: spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            borderRadius: radius.pill,
            borderWidth: borders.hairline,
            borderColor: colors.border,
            backgroundColor: isInk ? colors.ink : colors[tone],
          },
          style,
        ]}
      >
        <NBText variant="label" dense numberOfLines={1}>
          {label}
        </NBText>
      </View>
    </InkProvider>
  );
}
