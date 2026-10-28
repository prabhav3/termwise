// Projected final grade: a 0–100 track with the worst-case → best-case band and a target flag.
// The words under the bar carry the meaning; color only reinforces it.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { NBText } from '@/components/ui';
import { useTheme } from '@/theme';

import { formatGrade, formatWeight, rangeOutlook, type RangeOutlook } from './model';

export interface RangeBarProps {
  min: number;
  max: number;
  /** Target percent, when the student has one. */
  target: number | null;
  targetLabel?: string | null;
  style?: StyleProp<ViewStyle>;
}

const BAR_HEIGHT = 22;
const FLAG = 8;

const OUTLOOK_TEXT: Record<RangeOutlook, string> = {
  secured: 'Target locked in',
  possible: 'Target still in play',
  out_of_reach: 'Target out of reach',
};

function pct(value: number): `${number}%` {
  return `${Math.min(100, Math.max(0, value))}%`;
}

export function RangeBar({ min, max, target, targetLabel, style }: RangeBarProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const outlook = rangeOutlook(low, high, target);
  const band = outlook === 'secured' ? colors.green : outlook === 'out_of_reach' ? colors.red : colors.yellow;
  const range = `${formatGrade(low)} to ${formatGrade(high)}`;
  const targetText = target !== null ? `Target ${formatWeight(target)}${targetLabel ? ` (${targetLabel})` : ''}` : null;
  const spoken = [
    `Projected final grade between ${range.replace(/%/g, ' percent')}`,
    targetText,
    outlook ? OUTLOOK_TEXT[outlook] : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View accessible accessibilityLabel={spoken} style={[{ gap: spacing.xs }, style]}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            borderWidth: borders.standard,
            borderRadius: radius.none,
          },
        ]}
      >
        <View
          style={[
            styles.band,
            {
              left: pct(low),
              width: pct(Math.min(Math.max(high - low, 1), 100 - Math.min(low, 99))),
              backgroundColor: band,
              borderColor: colors.border,
              borderLeftWidth: borders.hairline,
              borderRightWidth: borders.hairline,
            },
          ]}
        />
        {target !== null ? (
          <View
            style={[
              styles.flag,
              {
                left: pct(target),
                marginLeft: -FLAG / 2,
                width: FLAG,
                backgroundColor: colors.ink,
                borderColor: colors.surface,
                borderLeftWidth: borders.hairline,
                borderRightWidth: borders.hairline,
              },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.legend}>
        <NBText variant="tiny" color="muted" dense>
          {`Final lands ${range}`}
        </NBText>
        {targetText ? (
          <NBText variant="tiny" dense style={styles.right}>
            {`▲ ${targetText}`}
          </NBText>
        ) : null}
      </View>
      {outlook ? (
        <NBText variant="smallBold" dense>
          {OUTLOOK_TEXT[outlook]}
        </NBText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: BAR_HEIGHT, overflow: 'visible' },
  band: { position: 'absolute', top: 0, bottom: 0 },
  flag: { position: 'absolute', top: -6, bottom: -6 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  right: { textAlign: 'right' },
});
