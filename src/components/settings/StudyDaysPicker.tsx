import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, NBText } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { WEEKDAY_LONG, WEEKDAY_SHORT } from '@/lib/dates';
import { useTheme } from '@/theme';

/** Monday-first, the way students think about a school week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function StudyDaysPicker({ value, onChange }: { value: readonly number[]; onChange: (days: number[]) => void }) {
  const { spacing } = useTheme();
  const [warning, setWarning] = useState<string | null>(null);

  const toggle = (day: number) => {
    if (value.includes(day)) {
      if (value.length === 1) {
        setWarning('Keep at least one study day — even one short session a week counts.');
        haptic('warning');
        return;
      }
      onChange(value.filter((d) => d !== day).sort((a, b) => a - b));
    } else {
      onChange([...value, day].sort((a, b) => a - b));
    }
    setWarning(null);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.wrap, { gap: spacing.sm }]} accessibilityRole="none" accessibilityLabel="Study days">
        {WEEK_ORDER.map((day) => (
          <Chip
            key={day}
            label={WEEKDAY_SHORT[day]}
            accessibilityLabel={WEEKDAY_LONG[day]}
            selected={value.includes(day)}
            onPress={() => toggle(day)}
          />
        ))}
      </View>
      {warning ? (
        <NBText variant="smallBold" color="danger" accessibilityRole="alert">
          {`⚠ ${warning}`}
        </NBText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
