import type { ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { haptic as playHaptic, type HapticKind } from '@/lib/haptics';
import { useTheme, type ShadowSize } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableSurfaceProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Hard shadow under the surface; pressing "clicks" the surface into it. */
  shadow?: ShadowSize | 'none';
  /** Haptic played on press (primary actions use 'light'). */
  haptic?: HapticKind | false;
  /** Dim to 45% while disabled (default). Loading buttons opt out so their spinner stays legible. */
  dimWhenDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const DISABLED_OPACITY = 0.45;

/**
 * The neo-brutalist press: while pressed the surface translates by its shadow offset and the
 * shadow collapses (120 ms). Reduce Motion skips the translate. Disabled = 45% opacity, no shadow.
 */
export function PressableSurface({
  shadow = 'md',
  haptic = false,
  dimWhenDisabled = true,
  disabled,
  style,
  children,
  onPressIn,
  onPressOut,
  onPress,
  accessibilityRole = 'button',
  accessibilityState,
  ...rest
}: PressableSurfaceProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const isDisabled = disabled === true;
  const offset = shadow === 'none' || isDisabled ? 0 : theme.shadowOffsets[shadow];
  const shadowColor = theme.colors.shadow;
  const duration = reduceMotion ? 0 : theme.motion.pressMs;

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const shift = reduceMotion ? 0 : offset * p;
    const remaining = offset * (1 - p);
    return {
      transform: [{ translateX: shift }, { translateY: shift }],
      boxShadow:
        remaining > 0
          ? [{ offsetX: remaining, offsetY: remaining, blurRadius: 0, spreadDistance: 0, color: shadowColor }]
          : [],
    };
  });

  const handlePressIn = (event: GestureResponderEvent) => {
    progress.set(withTiming(1, { duration }));
    onPressIn?.(event);
  };
  const handlePressOut = (event: GestureResponderEvent) => {
    progress.set(withTiming(0, { duration }));
    onPressOut?.(event);
  };
  const handlePress = (event: GestureResponderEvent) => {
    if (haptic) playHaptic(haptic);
    onPress?.(event);
  };

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle, isDisabled && dimWhenDisabled ? { opacity: DISABLED_OPACITY } : null]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
