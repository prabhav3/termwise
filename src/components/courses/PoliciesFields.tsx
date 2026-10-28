import { StyleSheet, View } from 'react-native';

import { NBText, TextField, Toggle } from '@/components/ui';
import { useTheme } from '@/theme';

export interface PolicyValues {
  late_policy: string | null;
  unannounced_quizzes: boolean;
  attendance_policy: string | null;
  drop_policy: string | null;
  extra_credit: string | null;
}

const TEXT_FIELDS: { key: Exclude<keyof PolicyValues, 'unannounced_quizzes'>; label: string; placeholder: string }[] = [
  { key: 'late_policy', label: 'Late work', placeholder: 'e.g. −10% per day, up to 3 days' },
  { key: 'attendance_policy', label: 'Attendance', placeholder: 'e.g. 3 free absences' },
  { key: 'drop_policy', label: 'Dropped grades', placeholder: 'e.g. Lowest quiz dropped' },
  { key: 'extra_credit', label: 'Extra credit', placeholder: 'e.g. Research participation, up to 2%' },
];

export function PoliciesFields({ value, onChange }: { value: PolicyValues; onChange: (value: PolicyValues) => void }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.toggleRow, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <NBText variant="bodyBold">Pop quizzes possible</NBText>
          <NBText variant="small" color="muted">
            Adds a 10-minute notes review on class days.
          </NBText>
        </View>
        <Toggle
          value={value.unannounced_quizzes}
          onValueChange={(next) => onChange({ ...value, unannounced_quizzes: next })}
          accessibilityLabel="Pop quizzes possible"
        />
      </View>
      {TEXT_FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          value={value[field.key] ?? ''}
          placeholder={field.placeholder}
          multiline
          onChangeText={(text) => onChange({ ...value, [field.key]: text.length > 0 ? text : null })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
