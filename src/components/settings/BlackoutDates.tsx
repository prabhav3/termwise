import { StyleSheet, View } from 'react-native';

import { Button, DateField, IconButton, NBText } from '@/components/ui';
import { formatLongDate, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';

const SHOWN = 8;

/** Days Termwise never plans work on (trips, shifts, religious holidays). */
export function BlackoutDates({
  value,
  today,
  onChange,
}: {
  value: readonly ISODate[];
  today: ISODate;
  onChange: (dates: ISODate[]) => void;
}) {
  const { colors, spacing, borders, radius } = useTheme();
  const sorted = [...new Set(value)].sort();
  const upcoming = sorted.filter((date) => date >= today);
  const past = sorted.filter((date) => date < today);

  const add = (date: ISODate) => {
    if (sorted.includes(date)) return;
    onChange([...sorted, date].sort());
  };
  const remove = (date: ISODate) => onChange(sorted.filter((d) => d !== date));

  return (
    <View style={{ gap: spacing.md }}>
      {upcoming.length === 0 ? (
        <NBText variant="small" color="muted">
          No days off planned. Add any day you can’t study and Termwise works around it.
        </NBText>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {upcoming.slice(0, SHOWN).map((date) => (
            <View
              key={date}
              style={[
                styles.row,
                {
                  gap: spacing.sm,
                  paddingLeft: spacing.md,
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                  borderWidth: borders.hairline,
                  borderRadius: radius.control,
                },
              ]}
            >
              <NBText variant="bodyMedium" style={styles.flex}>
                {formatLongDate(date)}
              </NBText>
              <IconButton
                icon="xmark"
                fallback="✕"
                label={`Remove ${formatLongDate(date)}`}
                variant="ghost"
                onPress={() => remove(date)}
              />
            </View>
          ))}
          {upcoming.length > SHOWN ? (
            <NBText variant="small" color="muted">{`…and ${upcoming.length - SHOWN} more`}</NBText>
          ) : null}
        </View>
      )}
      <DateField label="Add a day off" value={null} placeholder="Pick a date" minimumDate={today} onChange={add} />
      {past.length > 0 ? (
        <Button
          label={`Clear ${past.length} past ${past.length === 1 ? 'day' : 'days'}`}
          variant="ghost"
          size="sm"
          onPress={() => onChange(upcoming)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  flex: { flex: 1 },
});
