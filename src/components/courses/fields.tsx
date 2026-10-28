// Small form pieces shared by the course editor, the item form and the review screen.
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Chip, NBText, TextField, TimeField } from '@/components/ui';
import { WEEKDAY_LONG, WEEKDAY_SHORT } from '@/lib/dates';
import { useTheme } from '@/theme';

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100);
}

function parseNumber(text: string): number | null | 'invalid' {
  const cleaned = text.trim().replace(/%$/, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 'invalid';
}

export interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  helper?: string;
  /** Whole numbers only (counts, pages). */
  integer?: boolean;
  min?: number;
  max?: number;
  /** Shown inside the field, e.g. "%" or "pts". */
  suffix?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Numeric text input that only reports valid numbers (or null when cleared). */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  helper,
  integer = false,
  min,
  max,
  suffix,
  containerStyle,
}: NumberFieldProps) {
  const [text, setText] = useState(() => formatNumber(value));
  const [synced, setSynced] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // A value changed from outside (e.g. "Use standard scale"): show it unless the text already says it.
  if (value !== synced) {
    setSynced(value);
    const parsed = parseNumber(text);
    if (parsed !== value) setText(formatNumber(value));
  }

  const handleChange = (next: string) => {
    setText(next);
    const parsed = parseNumber(next);
    if (parsed === 'invalid') {
      setError('Enter a number.');
      return;
    }
    if (parsed !== null && integer && !Number.isInteger(parsed)) {
      setError('Use a whole number.');
      return;
    }
    if (parsed !== null && min !== undefined && parsed < min) {
      setError(`Use ${min} or more.`);
      return;
    }
    if (parsed !== null && max !== undefined && parsed > max) {
      setError(`Use ${max} or less.`);
      return;
    }
    setError(null);
    setSynced(parsed);
    onChange(parsed);
  };

  return (
    <TextField
      label={label}
      value={text}
      onChangeText={handleChange}
      placeholder={placeholder}
      helper={helper}
      error={error}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      returnKeyType="done"
      containerStyle={containerStyle}
      right={
        suffix ? (
          <NBText variant="bodyBold" color="muted" accessible={false}>
            {suffix}
          </NBText>
        ) : undefined
      }
    />
  );
}

/** Two or more fields side by side, each taking an equal share. */
export function FieldRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { spacing } = useTheme();
  return <View style={[styles.row, { gap: spacing.md }, style]}>{children}</View>;
}

export function FieldCell({ children, flex = 1 }: { children: ReactNode; flex?: number }) {
  return <View style={{ flex, minWidth: 0 }}>{children}</View>;
}

/** Monday-first, the way students think about a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export interface MeetingFieldsProps {
  days: number[];
  start: string | null;
  end: string | null;
  onChange: (next: { days: number[]; start: string | null; end: string | null }) => void;
}

/** Class meeting days and times. */
export function MeetingFields({ days, start, end, onChange }: MeetingFieldsProps) {
  const { spacing } = useTheme();
  const toggle = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    onChange({ days: next, start, end });
  };
  const endBeforeStart = start !== null && end !== null && end.slice(0, 5) <= start.slice(0, 5);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <NBText variant="label" color="muted">
          Meets on
        </NBText>
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {WEEK_ORDER.map((day) => (
            <Chip
              key={day}
              label={WEEKDAY_SHORT[day]}
              accessibilityLabel={WEEKDAY_LONG[day]}
              selected={days.includes(day)}
              onPress={() => toggle(day)}
            />
          ))}
        </View>
      </View>
      <FieldRow>
        <FieldCell>
          <TimeField label="Starts" value={start} placeholder="Time" onChange={(value) => onChange({ days, start: value, end })} />
        </FieldCell>
        <FieldCell>
          <TimeField
            label="Ends"
            value={end}
            placeholder="Time"
            error={endBeforeStart ? 'Ends before it starts' : null}
            onChange={(value) => onChange({ days, start, end: value })}
          />
        </FieldCell>
      </FieldRow>
    </View>
  );
}

/** "Mon, Wed · 10:00 AM–11:15 AM" (empty string when nothing is known). */
export function describeMeetings(days: readonly number[], start: string | null, end: string | null, formatTime: (t: string) => string): string {
  const dayText = WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_SHORT[d])
    .join(', ');
  const timeText = start ? (end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start)) : '';
  return [dayText, timeText].filter(Boolean).join(' · ');
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
