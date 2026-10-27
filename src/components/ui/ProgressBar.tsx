import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type AccentColor } from '@/theme';

import { resolveFill } from './fills';

export interface ProgressBarProps {
  /** 0..1 (clamped). */
  value: number;
  /** Spoken name, e.g. "Reading progress". */
  label: string;
  color?: AccentColor | 'primary' | (string & {});
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, label, color = 'green', height = 18, style }: ProgressBarProps) {
  const { colors, borders, radius } = useTheme();
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(clamped * 100);
  const fill = color === 'primary' ? colors.primary : resolveFill(color, colors);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={[
        {
          height,
          borderWidth: borders.standard,
          borderColor: colors.border,
          borderRadius: radius.control,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${percent}%`,
          height: '100%',
          backgroundColor: fill,
          borderRightWidth: percent > 0 && percent < 100 ? borders.hairline : 0,
          borderRightColor: colors.border,
        }}
      />
    </View>
  );
}
