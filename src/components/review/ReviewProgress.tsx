// The bold "we're reading it" view while parse-syllabus works.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Button, Card, Icon, NBText } from '@/components/ui';
import { useTheme } from '@/theme';

const STEPS = ['Uploaded', 'Reading', 'Ready to review'] as const;

export interface ReviewProgressProps {
  kind: 'syllabus' | 'toc';
  note: string | null;
  /** The parse has not been started (the start call failed): show a Start button. */
  notStarted: boolean;
  onStart: () => void;
  starting: boolean;
  onLeave: () => void;
  onDiscard: () => void;
  discarding: boolean;
}

function PulsingBar() {
  const { colors, borders, radius } = useTheme();
  const reduceMotion = useReducedMotion();
  const position = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      position.set(0.5);
      return;
    }
    position.set(withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })), -1));
  }, [reduceMotion, position]);

  const fill = useAnimatedStyle(() => ({ left: `${position.get() * 60}%` }));

  return (
    <View
      accessible={false}
      style={[
        styles.track,
        { borderWidth: borders.standard, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.surface },
      ]}
    >
      <Animated.View style={[styles.fill, { backgroundColor: colors.ink }, fill]} />
    </View>
  );
}

export function ReviewProgress({ kind, note, notStarted, onStart, starting, onLeave, onDiscard, discarding }: ReviewProgressProps) {
  const { spacing } = useTheme();
  const what = kind === 'toc' ? 'table of contents' : 'syllabus';
  const current = notStarted ? 0 : 1;
  const headline = notStarted ? `Your ${what} is uploaded` : `Reading your ${what}`;
  const line = notStarted ? 'We haven’t started reading it yet.' : (note ?? 'Getting started…');

  return (
    <View style={{ gap: spacing.xl }}>
      <Card color="yellow" shadow="lg" style={{ gap: spacing.lg }}>
        <NBText variant="display">{headline}</NBText>
        <NBText variant="h3" accessibilityLiveRegion="polite" accessibilityRole="text">
          {line}
        </NBText>
        {notStarted ? null : <PulsingBar />}
        <View style={{ gap: spacing.sm }}>
          {STEPS.map((step, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <View
                key={step}
                accessible
                accessibilityLabel={`${step}: ${done ? 'done' : active ? 'in progress' : 'next'}`}
                style={[styles.step, { gap: spacing.sm }]}
              >
                <Icon
                  name={done ? 'checkmark.circle.fill' : active ? 'circle.dotted' : 'circle'}
                  fallback={done ? '✓' : active ? '◌' : '○'}
                  size={20}
                />
                <NBText variant={active ? 'bodyBold' : 'body'}>{step}</NBText>
              </View>
            );
          })}
        </View>
      </Card>
      <NBText variant="body" color="muted">
        {notStarted
          ? 'Start it now, or come back later from the Courses tab.'
          : 'This usually takes under a minute. You can leave — it keeps going and shows up on the Courses tab when it’s ready.'}
      </NBText>
      <View style={{ gap: spacing.md }}>
        {notStarted ? <Button label="Start reading" size="lg" fullWidth loading={starting} onPress={onStart} /> : null}
        <Button label={notStarted ? 'Later' : 'Keep going in the background'} variant="secondary" fullWidth onPress={onLeave} />
        <Button label="Discard this upload" variant="ghost" fullWidth loading={discarding} onPress={onDiscard} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 20, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, width: '40%' },
  step: { flexDirection: 'row', alignItems: 'center' },
});
