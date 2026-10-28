// Single-select pickers: term, course, course color.
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip, Icon, NBText, TextField } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';
import type { Course, Term } from '@/types/db';

export type TermSelection = { kind: 'existing'; termId: string } | { kind: 'new'; name: string } | { kind: 'none' };

export interface TermPickerProps {
  terms: readonly Term[];
  value: TermSelection;
  onChange: (value: TermSelection) => void;
  /** Suggested name when the student taps "New term". */
  suggestedName?: string | null;
}

export function TermPicker({ terms, value, onChange, suggestedName }: TermPickerProps) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <NBText variant="label" color="muted">
        Term
      </NBText>
      <View accessibilityRole="radiogroup" accessibilityLabel="Term" style={[styles.wrap, { gap: spacing.sm }]}>
        {terms.map((term) => (
          <Chip
            key={term.id}
            role="radio"
            label={term.name}
            selected={value.kind === 'existing' && value.termId === term.id}
            onPress={() => onChange({ kind: 'existing', termId: term.id })}
          />
        ))}
        <Chip
          role="radio"
          label="New term"
          icon={{ name: 'plus', fallback: '+' }}
          selected={value.kind === 'new'}
          onPress={() => onChange({ kind: 'new', name: value.kind === 'new' ? value.name : (suggestedName ?? '') })}
        />
        <Chip role="radio" label="No term" selected={value.kind === 'none'} onPress={() => onChange({ kind: 'none' })} />
      </View>
      {value.kind === 'new' ? (
        <TextField
          label="New term name"
          value={value.name}
          placeholder="e.g. Fall 2026"
          autoCapitalize="words"
          onChangeText={(name) => onChange({ kind: 'new', name })}
          error={value.name.trim() ? null : 'Give the term a name'}
        />
      ) : null}
    </View>
  );
}

export interface CoursePickerProps {
  courses: readonly Course[];
  value: string | null;
  onChange: (courseId: string) => void;
  label?: string;
}

/** Course chips (code, else title). */
export function CoursePicker({ courses, value, onChange, label = 'Course' }: CoursePickerProps) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <NBText variant="label" color="muted">
        {label}
      </NBText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.wrap, { gap: spacing.sm }]}>
        {courses.map((course) => (
          <Chip
            key={course.id}
            role="radio"
            label={course.code ?? course.title}
            accessibilityLabel={course.code ? `${course.code}, ${course.title}` : course.title}
            selected={value === course.id}
            onPress={() => onChange(course.id)}
          />
        ))}
      </View>
    </View>
  );
}

const COLOR_NAMES = ['Blue', 'Pink', 'Yellow', 'Green', 'Orange', 'Purple', 'Teal', 'Lime'];

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const theme = useTheme();
  const { colors, borders, radius, spacing, courseColors } = theme;
  return (
    <View style={{ gap: spacing.sm }}>
      <NBText variant="label" color="muted">
        Color
      </NBText>
      <View accessibilityRole="radiogroup" accessibilityLabel="Course color" style={[styles.wrap, { gap: spacing.sm }]}>
        {courseColors.map((color, index) => {
          const selected = value.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={color}
              accessibilityRole="radio"
              accessibilityLabel={COLOR_NAMES[index] ?? `Color ${index + 1}`}
              accessibilityState={{ selected }}
              onPress={() => {
                haptic('selection');
                onChange(color);
              }}
              style={[
                styles.swatch,
                {
                  backgroundColor: color,
                  borderColor: colors.border,
                  borderWidth: selected ? borders.standard + 1 : borders.standard,
                  borderRadius: radius.control,
                },
                selected ? null : theme.shadow('sm'),
              ]}
            >
              {selected ? <Icon name="checkmark" fallback="✓" size={20} weight="heavy" color={colors.onAccent} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  swatch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
