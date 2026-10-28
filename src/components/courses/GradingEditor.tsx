// Grading breakdown editor (review draft and the manual course editor share it). Manual weight
// entry is a first-class path: every number is editable and the total updates live.
import { randomUUID } from 'expo-crypto';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Icon, IconButton, NBText, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

import { FieldCell, FieldRow, NumberField } from './fields';

export interface GradingRow {
  key: string;
  /** Database id for saved components (course editor); absent for new rows. */
  id?: string;
  name: string;
  weight: number | null;
  expected_count: number | null;
  drop_lowest: number;
  /** AI confidence (review only); below 0.7 the row gets a "Check" badge. */
  confidence?: number | null;
}

export function newGradingRow(): GradingRow {
  return { key: randomUUID(), name: '', weight: null, expected_count: null, drop_lowest: 0 };
}

export function gradingTotal(rows: readonly Pick<GradingRow, 'weight'>[]): number {
  return Math.round(rows.reduce((sum, row) => sum + (row.weight ?? 0), 0) * 10) / 10;
}

/** "Adds up to 100%" with a check, or how far off it is (text + icon, never color alone). */
export function WeightTotal({ total, count }: { total: number; count: number }) {
  const { colors, borders, radius, spacing } = useTheme();
  const ok = Math.abs(total - 100) <= 0.5;
  const diff = Math.round(Math.abs(100 - total) * 10) / 10;
  const detail = count === 0 ? 'No categories yet' : ok ? 'Looks right' : total < 100 ? `${diff}% missing` : `${diff}% over`;
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Grading weights add up to ${total} percent. ${detail}.`}
      style={[
        styles.total,
        {
          gap: spacing.md,
          padding: spacing.md,
          borderWidth: borders.standard,
          borderColor: colors.border,
          borderRadius: radius.control,
          backgroundColor: ok ? colors.green : count === 0 ? colors.surfaceAlt : colors.orange,
        },
      ]}
    >
      <Icon
        name={ok ? 'checkmark.seal.fill' : 'exclamationmark.triangle.fill'}
        fallback={ok ? '✓' : '⚠'}
        size={22}
        color={count === 0 ? colors.ink : colors.onAccent}
      />
      <View style={styles.flex}>
        <NBText variant="label" color={count === 0 ? 'inkMuted' : 'onAccent'}>
          Adds up to
        </NBText>
        <NBText variant="h2" color={count === 0 ? 'ink' : 'onAccent'}>{`${total}%`}</NBText>
      </View>
      <NBText variant="smallBold" color={count === 0 ? 'inkMuted' : 'onAccent'}>
        {detail}
      </NBText>
    </View>
  );
}

export interface GradingEditorProps {
  rows: GradingRow[];
  onChange: (rows: GradingRow[]) => void;
}

export function GradingEditor({ rows, onChange }: GradingEditorProps) {
  const { spacing } = useTheme();
  const total = gradingTotal(rows);
  const update = (key: string, patch: Partial<GradingRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));

  return (
    <View style={{ gap: spacing.md }}>
      <WeightTotal total={total} count={rows.length} />
      {rows.map((row, index) => {
        const label = row.name.trim() || `Category ${index + 1}`;
        return (
          <Card key={row.key} shadow="sm" style={{ gap: spacing.md }}>
            <View style={[styles.header, { gap: spacing.sm }]}>
              <NBText variant="label" color="muted" style={styles.flex}>
                {`Category ${index + 1}`}
              </NBText>
              {row.confidence !== undefined && row.confidence !== null && row.confidence < 0.7 ? (
                <Badge label="Check" tone="orange" accessibilityLabel="Low confidence, please check" />
              ) : null}
              <IconButton icon="trash" fallback="✕" label={`Remove ${label}`} variant="ghost" onPress={() => remove(row.key)} />
            </View>
            <FieldRow>
              <FieldCell flex={2}>
                <TextField
                  label="Name"
                  value={row.name}
                  placeholder="e.g. Quizzes"
                  onChangeText={(name) => update(row.key, { name })}
                  autoCapitalize="words"
                />
              </FieldCell>
              <FieldCell>
                <NumberField
                  label="Weight"
                  value={row.weight}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(weight) => update(row.key, { weight })}
                />
              </FieldCell>
            </FieldRow>
            <FieldRow>
              <FieldCell>
                <NumberField
                  label="How many"
                  value={row.expected_count}
                  integer
                  min={0}
                  max={200}
                  placeholder="Any"
                  onChange={(expected_count) => update(row.key, { expected_count })}
                />
              </FieldCell>
              <FieldCell>
                <NumberField
                  label="Drop lowest"
                  value={row.drop_lowest}
                  integer
                  min={0}
                  max={50}
                  onChange={(drop) => update(row.key, { drop_lowest: drop ?? 0 })}
                />
              </FieldCell>
            </FieldRow>
          </Card>
        );
      })}
      <Button
        label="Add a grade category"
        variant="secondary"
        icon={{ name: 'plus', fallback: '+' }}
        onPress={() => onChange([...rows, newGradingRow()])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  total: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
