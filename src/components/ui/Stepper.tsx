import { StyleSheet, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { IconButton } from './IconButton';
import { NBText } from './NBText';

export interface StepperProps {
  /** Spoken name, e.g. "Daily study time". */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Display + spoken value, e.g. (180) => "3h". */
  format?: (value: number) => string;
  /** Small caption under the number, e.g. "pages per hour". */
  unit?: string;
  style?: StyleProp<ViewStyle>;
}

/** − value + with a big Archivo number. VoiceOver treats it as one adjustable control. */
export function Stepper({ label, value, onChange, min, max, step = 1, format, unit, style }: StepperProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const shown = format ? format(value) : String(value);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const decrement = () => onChange(clamp(value - step));
  const increment = () => onChange(clamp(value + step));

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') increment();
    if (event.nativeEvent.actionName === 'decrement') decrement();
  };

  return (
    <View
      style={[
        styles.row,
        {
          gap: spacing.md,
          padding: spacing.md,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: borders.standard,
          borderRadius: radius.card,
        },
        style,
      ]}
    >
      <IconButton icon="minus" fallback="−" label={`Decrease ${label}`} onPress={decrement} disabled={value <= min} />
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: unit ? `${shown} ${unit}` : shown }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        style={styles.value}
      >
        <NBText variant="number" align="center" dense numberOfLines={1} adjustsFontSizeToFit>
          {shown}
        </NBText>
        {unit ? (
          <NBText variant="label" color="muted" align="center">
            {unit}
          </NBText>
        ) : null}
      </View>
      <IconButton icon="plus" fallback="+" label={`Increase ${label}`} onPress={increment} disabled={value >= max} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, alignItems: 'center' },
});
