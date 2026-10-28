import { StyleSheet, View } from 'react-native';

import { Icon, NBText } from '@/components/ui';
import type { DayLoad } from '@/engine';
import { formatMinutes } from '@/lib/dates';
import { useTheme } from '@/theme';

import { spokenMinutes } from './labels';

export interface DayLoadBarProps {
  load: DayLoad;
  /** Minutes the full bar width stands for (the week's busiest day or the daily capacity). */
  scale: number;
  dayName: string;
}

/** Done + planned minutes against the day's capacity (the ink tick). Overloaded days say so in words. */
export function DayLoadBar({ load, scale, dayName }: DayLoadBarProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const total = load.minutes + load.doneMinutes;
  const width = Math.max(1, scale);
  const donePct = Math.min(100, (load.doneMinutes / width) * 100);
  const plannedPct = Math.min(100 - donePct, (load.minutes / width) * 100);
  const capacityPct = Math.min(100, (load.capacity / width) * 100);
  const over = load.overloaded ? total - load.capacity : 0;

  const summary =
    !load.isStudyDay && total === 0
      ? 'Not a study day'
      : total === 0
        ? `Nothing planned · ${formatMinutes(load.capacity)} free`
        : `${formatMinutes(total)} of ${load.isStudyDay ? formatMinutes(load.capacity) : '0 min'}${load.doneMinutes > 0 ? ` · ${formatMinutes(load.doneMinutes)} done` : ''}`;

  const spoken = [
    `${dayName}:`,
    total === 0 ? 'nothing planned' : `${spokenMinutes(total)} planned`,
    load.isStudyDay ? `of ${spokenMinutes(load.capacity)} free` : 'not a study day',
    load.doneMinutes > 0 ? `${spokenMinutes(load.doneMinutes)} done` : null,
    over > 0 ? `overloaded by ${spokenMinutes(over)}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={spoken} style={{ gap: spacing.xs }}>
      <View
        style={[
          styles.track,
          {
            borderWidth: borders.standard,
            borderColor: colors.border,
            borderRadius: radius.control,
            backgroundColor: colors.surface,
          },
        ]}
      >
        {donePct > 0 ? <View style={{ width: `${donePct}%`, backgroundColor: colors.green }} /> : null}
        {plannedPct > 0 ? (
          <View
            style={{
              width: `${plannedPct}%`,
              backgroundColor: load.overloaded ? colors.orange : colors.blue,
              borderLeftWidth: donePct > 0 ? borders.hairline : 0,
              borderRightWidth: donePct + plannedPct < 100 ? borders.hairline : 0,
              borderColor: colors.border,
            }}
          />
        ) : null}
        {load.isStudyDay && capacityPct > 0 && capacityPct < 100 ? (
          <View
            style={[styles.capacity, { left: `${capacityPct}%`, width: borders.standard, backgroundColor: colors.ink }]}
          />
        ) : null}
      </View>
      <View style={[styles.row, { gap: spacing.xs }]}>
        {over > 0 ? <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={14} color={colors.ink} /> : null}
        <NBText variant={over > 0 ? 'smallBold' : 'small'} color={over > 0 ? undefined : 'muted'} dense>
          {over > 0 ? `Over by ${formatMinutes(over)} · ${summary}` : summary}
        </NBText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 20, flexDirection: 'row', overflow: 'hidden' },
  capacity: { position: 'absolute', top: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
