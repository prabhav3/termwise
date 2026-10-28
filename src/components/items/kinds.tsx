import { StyleSheet, View } from 'react-native';

import { Chip, Tag } from '@/components/ui';
import { useTheme, type AccentColor } from '@/theme';
import { ITEM_KINDS, type ItemKind } from '@/types/db';

export const KIND_LABEL: Record<ItemKind, string> = {
  exam: 'Exam',
  quiz: 'Quiz',
  paper: 'Paper',
  project: 'Project',
  homework: 'Homework',
  reading: 'Reading',
  presentation: 'Presentation',
  lab: 'Lab',
  discussion: 'Discussion',
  other: 'Other',
};

const KIND_TONE: Record<ItemKind, AccentColor> = {
  exam: 'red',
  quiz: 'orange',
  paper: 'purple',
  project: 'blue',
  homework: 'yellow',
  reading: 'green',
  presentation: 'pink',
  lab: 'blue',
  discussion: 'pink',
  other: 'yellow',
};

/** Square stamp with the kind word (color is decoration; the word carries the meaning). */
export function KindTag({ kind }: { kind: ItemKind }) {
  return <Tag label={KIND_LABEL[kind]} color={KIND_TONE[kind]} />;
}

/** Single-select kind chips. */
export function KindPicker({ value, onChange }: { value: ItemKind; onChange: (kind: ItemKind) => void }) {
  const { spacing } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Kind" style={[styles.wrap, { gap: spacing.sm }]}>
      {ITEM_KINDS.map((kind) => (
        <Chip key={kind} role="radio" label={KIND_LABEL[kind]} selected={value === kind} onPress={() => onChange(kind)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
