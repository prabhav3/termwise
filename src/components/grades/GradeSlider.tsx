// Neo-brutalist percent slider: a chunky bordered track, a square thumb with a hard shadow that
// "clicks in" while dragged, and − / + buttons beside it as the precise (and motor-friendly)
// fallback. VoiceOver sees one adjustable control with increment / decrement actions.
//
// Needs a GestureHandlerRootView ancestor (the grade tracker route provides one).
import { useEffect, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IconButton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme, type AccentColor } from '@/theme';

export interface GradeSliderProps {
  /** Spoken name, e.g. "Final Exam score". */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Step for dragging and the − / + buttons. */
  step?: number;
  /** Step for VoiceOver swipe up / down. */
  accessibilityStep?: number;
  /** Spoken value, e.g. (85) => "85 percent". */
  formatValue?: (value: number) => string;
  color?: AccentColor;
  style?: StyleProp<ViewStyle>;
}

const TRACK_HEIGHT = 18;
const THUMB = 30;
const TOUCH_HEIGHT = 44;

export function GradeSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  accessibilityStep = 5,
  formatValue = (v) => `${v} percent`,
  color = 'blue',
  style,
}: GradeSliderProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing, motion, shadowOffsets } = theme;
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const range = Math.max(step, max - min);
  const clampValue = (next: number) => Math.min(max, Math.max(min, Math.round(next / step) * step));

  // Thumb position (0..width) lives on the UI thread while dragging.
  const width = useSharedValue(0);
  const position = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastSent = useSharedValue(value);
  const pressed = useSharedValue(0);

  useEffect(() => {
    // Outside changes (stepper, reset, VoiceOver) move the thumb; a drag in progress owns it.
    lastSent.set(value);
    if (dragging.get()) return;
    position.set(((value - min) / range) * trackWidth);
  }, [value, min, range, trackWidth, position, dragging, lastSent]);

  const emit = (next: number) => {
    // A tick every 5 points keeps the drag tactile without buzzing on every step.
    if (next % 5 === 0) haptic('selection');
    onChange(next);
  };

  const pressMs = reduceMotion ? 0 : motion.pressMs;

  const pan = usePanGesture({
    activeOffsetX: [-6, 6],
    failOffsetY: [-14, 14],
    onBegin: () => {
      pressed.set(withTiming(1, { duration: pressMs }));
    },
    onActivate: () => {
      dragging.set(true);
      dragStart.set(position.get());
    },
    onUpdate: (event) => {
      const w = width.get();
      if (w <= 0) return;
      const x = Math.min(w, Math.max(0, dragStart.get() + event.translationX));
      position.set(x);
      const raw = min + (x / w) * range;
      const next = Math.min(max, Math.max(min, Math.round(raw / step) * step));
      if (next !== lastSent.get()) {
        lastSent.set(next);
        scheduleOnRN(emit, next);
      }
    },
    onFinalize: () => {
      dragging.set(false);
      pressed.set(withTiming(0, { duration: pressMs }));
      const w = width.get();
      position.set(withTiming(((lastSent.get() - min) / range) * w, { duration: pressMs }));
    },
  });

  const tap = useTapGesture({
    maxDistance: 8,
    onActivate: (event) => {
      const w = width.get();
      if (w <= 0) return;
      const x = Math.min(w, Math.max(0, event.x - THUMB / 2));
      const raw = min + (x / w) * range;
      const next = Math.min(max, Math.max(min, Math.round(raw / step) * step));
      position.set(withTiming(((next - min) / range) * w, { duration: pressMs }));
      if (next !== lastSent.get()) {
        lastSent.set(next);
        scheduleOnRN(emit, next);
      }
    },
    onFinalize: () => {
      pressed.set(withTiming(0, { duration: pressMs }));
    },
  });

  const gesture = useCompetingGestures(pan, tap);

  const offset = shadowOffsets.sm;
  const shadowColor = colors.shadow;
  const thumbStyle = useAnimatedStyle(() => {
    const p = pressed.get();
    const shift = reduceMotion ? 0 : offset * p;
    const remaining = offset * (1 - p);
    return {
      transform: [{ translateX: position.get() + shift }, { translateY: shift }],
      boxShadow:
        remaining > 0 ? [{ offsetX: remaining, offsetY: remaining, blurRadius: 0, spreadDistance: 0, color: shadowColor }] : [],
    };
  });
  const fillStyle = useAnimatedStyle(() => ({ width: Math.max(0, position.get()) }));

  const onLayout = (event: LayoutChangeEvent) => {
    const usable = Math.max(0, event.nativeEvent.layout.width - THUMB);
    width.set(usable);
    setTrackWidth(usable);
  };

  const nudge = (delta: number) => {
    const next = clampValue(value + delta);
    if (next !== value) onChange(next);
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') nudge(accessibilityStep);
    if (event.nativeEvent.actionName === 'decrement') nudge(-accessibilityStep);
  };

  return (
    <View style={[styles.row, { gap: spacing.sm }, style]}>
      <IconButton
        icon="minus"
        fallback="−"
        label={`Lower ${label}`}
        onPress={() => nudge(-step)}
        disabled={value <= min}
      />
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityHint="Swipe up or down to adjust, or drag the handle."
          accessibilityValue={{ min, max, now: value, text: formatValue(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
          onLayout={onLayout}
          style={styles.touch}
        >
          <View
            style={[
              styles.track,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
                borderWidth: borders.standard,
                borderRadius: radius.control,
              },
            ]}
          >
            <Animated.View
              style={[styles.fill, { backgroundColor: colors[color], borderRadius: radius.control - borders.standard }, fillStyle]}
            />
          </View>
          <Animated.View
            style={[
              styles.thumb,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: borders.standard,
                borderRadius: radius.control,
              },
              thumbStyle,
            ]}
          >
            <View style={[styles.grip, { backgroundColor: colors.ink }]} />
            <View style={[styles.grip, { backgroundColor: colors.ink }]} />
          </Animated.View>
        </View>
      </GestureDetector>
      <IconButton
        icon="plus"
        fallback="+"
        label={`Raise ${label}`}
        onPress={() => nudge(step)}
        disabled={value >= max}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  touch: { flex: 1, height: TOUCH_HEIGHT, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: TRACK_HEIGHT,
    top: (TOUCH_HEIGHT - TRACK_HEIGHT) / 2,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    left: 0,
    top: (TOUCH_HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  grip: { width: 3, height: 12 },
});
