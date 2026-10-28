import { randomUUID } from 'expo-crypto';
import { StyleSheet, View } from 'react-native';

import { Button, IconButton, NBText, TextField } from '@/components/ui';
import { DEFAULT_GRADE_SCALE } from '@/engine';
import { useTheme } from '@/theme';
import type { GradeCutoff } from '@/types/db';

import { NumberField } from './fields';

export interface ScaleRow {
  key: string;
  letter: string;
  min: number | null;
}

export function toScaleRows(scale: readonly GradeCutoff[]): ScaleRow[] {
  return scale.map((cutoff) => ({ key: randomUUID(), letter: cutoff.letter, min: cutoff.min }));
}

/** Highest cutoff first, empty letters dropped. */
export function fromScaleRows(rows: readonly ScaleRow[]): GradeCutoff[] {
  return rows
    .filter((row) => row.letter.trim() && row.min !== null)
    .map((row) => ({ letter: row.letter.trim(), min: row.min ?? 0 }))
    .sort((a, b) => b.min - a.min);
}

export function GradeScaleEditor({ rows, onChange }: { rows: ScaleRow[]; onChange: (rows: ScaleRow[]) => void }) {
  const { spacing } = useTheme();
  const update = (key: string, patch: Partial<ScaleRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <View style={{ gap: spacing.md }}>
      {rows.length === 0 ? (
        <NBText variant="small" color="muted">
          No letter grades yet. The standard A–F scale is used until you add one.
        </NBText>
      ) : null}
      {rows.map((row) => (
        <View key={row.key} style={[styles.row, { gap: spacing.md }]}>
          <TextField
            label="Letter"
            value={row.letter}
            onChangeText={(letter) => update(row.key, { letter })}
            autoCapitalize="characters"
            containerStyle={styles.letter}
          />
          <NumberField
            label="From"
            value={row.min}
            min={0}
            max={100}
            suffix="%"
            onChange={(min) => update(row.key, { min })}
            containerStyle={styles.flex}
          />
          <IconButton
            icon="trash"
            fallback="✕"
            label={`Remove ${row.letter || 'letter'}`}
            variant="ghost"
            onPress={() => onChange(rows.filter((r) => r.key !== row.key))}
            style={styles.remove}
          />
        </View>
      ))}
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          label="Add letter"
          size="sm"
          variant="secondary"
          icon={{ name: 'plus', fallback: '+' }}
          onPress={() => onChange([...rows, { key: randomUUID(), letter: '', min: null }])}
        />
        <Button label="Use standard scale" size="sm" variant="ghost" onPress={() => onChange(toScaleRows(DEFAULT_GRADE_SCALE))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  letter: { width: 88 },
  flex: { flex: 1 },
  remove: { marginTop: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
