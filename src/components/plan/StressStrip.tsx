import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, NBText, stressLabel } from '@/components/ui';
import type { StressLevel, WeekStress } from '@/engine';
import { formatShortDate, type ISODate } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { Stripes } from './Stripes';

export interface StressStripProps {
  weeks: readonly WeekStress[];
  today: ISODate;
  onSelectWeek: (weekStart: ISODate) => void;
}

const BAR_AREA = 112;
const MIN_BAR = 12;
const COLUMN = 52;

function spokenWeek(week: WeekStress, current: boolean): string {
  const parts = [
    `${current ? 'This week, ' : ''}week of ${formatShortDate(week.week_start)}`,
    `stress ${week.score}, ${stressLabel(week.level).toLowerCase()}`,
    week.deadlines === 0
      ? 'no deadlines'
      : `${week.deadlines} ${week.deadlines === 1 ? 'deadline' : 'deadlines'}${week.majorDeadlines > 0 ? `, ${week.majorDeadlines} major` : ''}`,
  ];
  for (const zone of week.redZones) parts.push(zone.message);
  return parts.join('. ');
}

/** 16 weekly bars, height = stress score; red-zone weeks are striped and flagged with ⚠. */
export function StressStrip({ weeks, today, onSelectWeek }: StressStripProps) {
  const theme = useTheme();
  const { colors, borders, spacing, stressColors } = theme;

  return (
    <View style={{ gap: spacing.md }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="list"
        accessibilityLabel="Stress by week"
        contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.xs }}
      >
        {weeks.map((week) => {
          const current = week.week_start <= today && today <= week.week_end;
          const height = Math.max(MIN_BAR, Math.round((Math.min(100, week.score) / 100) * BAR_AREA));
          const red = week.level === 'red';
          const hasZone = week.redZones.some((zone) => zone.severity === 'red');
          return (
            <Pressable
              key={week.week_start}
              accessibilityRole="button"
              accessibilityLabel={spokenWeek(week, current)}
              accessibilityHint="Opens that week"
              onPress={() => {
                haptic('selection');
                onSelectWeek(week.week_start);
              }}
              style={({ pressed }) => [styles.column, { width: COLUMN, gap: spacing.xs, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={styles.zoneLabel}>
                {red || hasZone ? (
                  <NBText variant="label" align="center" numberOfLines={1} dense>
                    Red
                  </NBText>
                ) : null}
              </View>
              <NBText variant="smallBold" align="center" dense>
                {String(week.score)}
              </NBText>
              <View style={[styles.barArea, { height: BAR_AREA }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: stressColors[week.level],
                      borderColor: colors.border,
                      borderWidth: borders.standard,
                    },
                    theme.shadow('sm'),
                  ]}
                >
                  {red || hasZone ? <Stripes opacity={0.3} gap={8} /> : null}
                  {red || hasZone ? (
                    <View style={styles.flag}>
                      <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={14} color={colors.onAccent} />
                    </View>
                  ) : null}
                </View>
              </View>
              <View
                style={[
                  styles.dateStamp,
                  {
                    backgroundColor: current ? colors.ink : 'transparent',
                    paddingHorizontal: 2,
                  },
                ]}
              >
                <NBText variant="tiny" color={current ? 'inkInverse' : 'muted'} align="center" numberOfLines={1} dense>
                  {current ? 'Now' : formatShortDate(week.week_start)}
                </NBText>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <StressLegend />
    </View>
  );
}

const LEGEND: readonly StressLevel[] = ['calm', 'busy', 'heavy', 'red'];

export function StressLegend() {
  const { colors, borders, spacing, stressColors } = useTheme();
  return (
    <View style={[styles.legend, { gap: spacing.md }]} accessible accessibilityLabel="Bar height is the stress score from 0 to 100. Calm, busy, heavy, and striped red-zone weeks.">
      {LEGEND.map((level) => (
        <View key={level} style={[styles.legendItem, { gap: spacing.xs }]}>
          <View
            style={{
              width: 14,
              height: 14,
              backgroundColor: stressColors[level],
              borderWidth: borders.hairline,
              borderColor: colors.border,
              overflow: 'hidden',
            }}
          >
            {level === 'red' ? <Stripes opacity={0.35} gap={5} /> : null}
          </View>
          <NBText variant="tiny" color="muted" dense>
            {stressLabel(level)}
          </NBText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'stretch', minHeight: 44 },
  barArea: { justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 0, alignItems: 'center' },
  zoneLabel: { minHeight: 16, justifyContent: 'flex-end' },
  flag: { paddingTop: 2 },
  dateStamp: { minHeight: 18, justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
});
