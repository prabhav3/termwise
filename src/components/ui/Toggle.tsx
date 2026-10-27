import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { Icon } from './Icon';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Required: what this switch controls. */
  accessibilityLabel: string;
  disabled?: boolean;
}

const TRACK_W = 58;
const TRACK_H = 34;
const KNOB = 24;

/** Chunky switch. On = green track, knob right with a check, so state is not color-only. */
export function Toggle({ value, onValueChange, accessibilityLabel, disabled = false }: ToggleProps) {
  const { colors, borders, radius, motion } = useTheme();
  const reduceMotion = useReducedMotion();
  const position = useSharedValue(value ? 1 : 0);
  const travel = TRACK_W - borders.standard * 2 - KNOB - 6;

  useEffect(() => {
    position.set(withTiming(value ? 1 : 0, { duration: reduceMotion ? 0 : motion.pressMs }));
  }, [value, reduceMotion, motion.pressMs, position]);

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + position.get() * travel }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptic('selection');
        onValueChange(!value);
      }}
      style={[
        styles.track,
        {
          backgroundColor: value ? colors.green : colors.surfaceAlt,
          borderColor: colors.border,
          borderWidth: borders.standard,
          borderRadius: radius.pill,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.knob,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: borders.hairline,
            borderRadius: KNOB / 2,
          },
          knobStyle,
        ]}
      >
        {value ? <Icon name="checkmark" fallback={'✓'} size={12} weight="heavy" color={colors.ink} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: TRACK_W, height: TRACK_H, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, alignItems: 'center', justifyContent: 'center' },
});
