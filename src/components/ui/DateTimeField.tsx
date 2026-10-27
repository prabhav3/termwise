import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  formatDayDate,
  formatTimeOfDay,
  isoToLocalDate,
  localDateToISO,
  localDateToTime,
  normalizeTime,
  timeToLocalDate,
  type ISODate,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { Button } from './Button';
import { Icon, type SymbolName } from './Icon';
import { NBText } from './NBText';
import { Sheet } from './Sheet';

type PickerMode = 'date' | 'time';

interface PickerFieldProps {
  mode: PickerMode;
  label: string;
  /** Text shown in the field. */
  display: string | null;
  placeholder: string;
  current: Date;
  onPick: (date: Date) => void;
  error?: string | null;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const ICON: Record<PickerMode, { name: SymbolName; fallback: string }> = {
  date: { name: 'calendar', fallback: '▦' },
  time: { name: 'clock', fallback: '◷' },
};

function PickerField({
  mode,
  label,
  display,
  placeholder,
  current,
  onPick,
  error,
  minimumDate,
  maximumDate,
  disabled,
  style,
}: PickerFieldProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing } = theme;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);

  const openPicker = () => {
    haptic('selection');
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode,
        minimumDate,
        maximumDate,
        onValueChange: (_event, date) => onPick(date),
      });
      return;
    }
    setDraft(current);
    setOpen(true);
  };

  return (
    <View style={[{ gap: spacing.xs }, style]}>
      <NBText variant="label" color="muted" accessible={false}>
        {label}
      </NBText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${display ?? placeholder}`}
        accessibilityHint={error ?? `Opens a ${mode} picker`}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.box,
          {
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
            borderColor: error ? colors.red : colors.border,
            borderWidth: borders.standard,
            borderRadius: radius.control,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        <NBText variant="body" color={display ? 'ink' : 'inkMuted'} style={styles.value} numberOfLines={1}>
          {display ?? placeholder}
        </NBText>
        <Icon name={ICON[mode].name} fallback={ICON[mode].fallback} size={18} color={colors.ink} />
      </Pressable>
      {error ? (
        <NBText variant="smallBold" color="red" accessibilityRole="alert">
          {`⚠ ${error}`}
        </NBText>
      ) : null}

      {Platform.OS !== 'android' ? (
        <Sheet
          visible={open}
          onClose={() => setOpen(false)}
          title={label}
          footer={
            <Button
              label="Done"
              fullWidth
              onPress={() => {
                setOpen(false);
                onPick(draft);
              }}
            />
          }
        >
          <DateTimePicker
            value={draft}
            mode={mode}
            display={mode === 'date' ? 'inline' : 'spinner'}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            themeVariant={theme.scheme}
            accentColor={colors.primary}
            textColor={colors.ink}
            minuteInterval={mode === 'time' ? 5 : undefined}
            onValueChange={(_event, date) => setDraft(date)}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

export interface DateFieldProps {
  label: string;
  value: ISODate | null;
  onChange: (value: ISODate) => void;
  placeholder?: string;
  minimumDate?: ISODate;
  maximumDate?: ISODate;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Calendar date field (local `YYYY-MM-DD`). */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Pick a date',
  minimumDate,
  maximumDate,
  error,
  disabled,
  style,
}: DateFieldProps) {
  return (
    <PickerField
      mode="date"
      label={label}
      display={value ? formatDayDate(value) : null}
      placeholder={placeholder}
      current={value ? isoToLocalDate(value) : new Date()}
      onPick={(date) => onChange(localDateToISO(date))}
      minimumDate={minimumDate ? isoToLocalDate(minimumDate) : undefined}
      maximumDate={maximumDate ? isoToLocalDate(maximumDate) : undefined}
      error={error}
      disabled={disabled}
      style={style}
    />
  );
}

export interface TimeFieldProps {
  label: string;
  /** `HH:MM` (or Postgres `HH:MM:SS`). */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Wall-clock time field (`HH:MM`). */
export function TimeField({ label, value, onChange, placeholder = 'Pick a time', error, disabled, style }: TimeFieldProps) {
  const normalized = value ? normalizeTime(value) : null;
  return (
    <PickerField
      mode="time"
      label={label}
      display={normalized ? formatTimeOfDay(normalized) : null}
      placeholder={placeholder}
      current={timeToLocalDate(normalized ?? '09:00')}
      onPick={(date) => onChange(localDateToTime(date))}
      error={error}
      disabled={disabled}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1 },
});
