import { StyleSheet, View } from 'react-native';

import { NBText } from '@/components/ui';
import { useTheme, type AccentColor } from '@/theme';
import type { GradingComponent } from '@/types/db';

const TONES: readonly AccentColor[] = ['blue', 'pink', 'yellow', 'green', 'orange', 'purple'];

function percent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/** Chunky stacked bar of the grading breakdown plus a legend that carries the actual numbers. */
export function GradingBar({ components }: { components: readonly GradingComponent[] }) {
  const { colors, borders, radius, spacing } = useTheme();
  const weighted = components.filter((c) => Number(c.weight) > 0);
  const total = weighted.reduce((sum, c) => sum + Number(c.weight), 0);
  const scale = Math.max(100, total);
  const spoken = `Grading breakdown: ${weighted.map((c) => `${c.name} ${percent(Number(c.weight))}`).join(', ')}. Total ${percent(total)}.`;

  return (
    <View style={{ gap: spacing.md }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={spoken}
        style={[
          styles.bar,
          {
            borderWidth: borders.standard,
            borderColor: colors.border,
            borderRadius: radius.control,
            backgroundColor: colors.surfaceAlt,
          },
        ]}
      >
        {weighted.map((component, index) => (
          <View
            key={component.id}
            style={{
              flex: Number(component.weight) / scale,
              backgroundColor: colors[TONES[index % TONES.length]],
              borderRightWidth: borders.hairline,
              borderRightColor: colors.border,
            }}
          />
        ))}
        {total < 100 ? <View style={{ flex: (100 - total) / scale }} /> : null}
      </View>
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ gap: spacing.xs }}>
        {weighted.map((component, index) => (
          <View key={component.id} style={[styles.legendRow, { gap: spacing.sm }]}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: colors[TONES[index % TONES.length]], borderColor: colors.border, borderWidth: borders.hairline },
              ]}
            />
            <NBText variant="small" style={styles.flex} numberOfLines={1}>
              {component.drop_lowest > 0 ? `${component.name} (drop ${component.drop_lowest})` : component.name}
            </NBText>
            <NBText variant="smallBold">{percent(Number(component.weight))}</NBText>
          </View>
        ))}
      </View>
      {Math.abs(total - 100) > 0.5 ? (
        <NBText variant="smallBold" color="muted">
          {`⚠ Weights add up to ${percent(total)}, not 100%.`}
        </NBText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 28, flexDirection: 'row', overflow: 'hidden' },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 14, height: 14 },
  flex: { flex: 1 },
});
