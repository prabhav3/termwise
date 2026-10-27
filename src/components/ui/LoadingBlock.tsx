import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

export interface LoadingBlockProps {
  /** Number of skeleton bars stacked in the block. */
  lines?: number;
  height?: number;
  width?: DimensionValue;
  /** Spoken while loading, e.g. "Loading your plan". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

const PULSE_MS = 700;

/** Bordered skeleton. Pulses gently; static when Reduce Motion is on. */
export function LoadingBlock({ lines = 3, height = 96, width = '100%', label = 'Loading', style }: LoadingBlockProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      pulse.set(1);
      return;
    }
    pulse.set(withRepeat(withSequence(withTiming(0.5, { duration: PULSE_MS }), withTiming(1, { duration: PULSE_MS })), -1));
  }, [reduceMotion, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        {
          width,
          minHeight: height,
          padding: spacing.lg,
          gap: spacing.sm,
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: borders.hairline,
          borderRadius: radius.card,
        },
        style,
      ]}
    >
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <Animated.View
          key={index}
          style={[
            {
              height: index === 0 ? 18 : 12,
              width: index === 0 ? '55%' : index % 2 === 0 ? '70%' : '90%',
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.none,
            },
            animated,
          ]}
        />
      ))}
    </View>
  );
}
