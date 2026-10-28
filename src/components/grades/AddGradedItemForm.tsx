// Inline form for graded work the syllabus didn't list (a pop quiz, a bonus lab).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, DateField, NBText, TextField, useToast } from '@/components/ui';
import { useCreateItem } from '@/data/items';
import type { NewRow } from '@/data';
import { errorMessage } from '@/lib/functions';
import type { ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { GradingComponent, ItemKind } from '@/types/db';

import { formatWeight, MAX_ENTRY_PERCENT, parseDecimal } from './model';

export interface AddGradedItemFormProps {
  courseId: string;
  /** This course's categories, in display order. */
  components: GradingComponent[];
  /** Category to preselect (null = none). */
  initialComponentId: string | null;
  today: ISODate;
  onClose: () => void;
}

const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'quiz', label: 'Quiz' },
  { value: 'homework', label: 'Homework' },
  { value: 'exam', label: 'Exam' },
  { value: 'lab', label: 'Lab' },
  { value: 'paper', label: 'Paper' },
  { value: 'other', label: 'Other' },
];

type FieldErrors = Partial<Record<'title' | 'score' | 'points' | 'weight', string>>;

export function AddGradedItemForm({ courseId, components, initialComponentId, today, onClose }: AddGradedItemFormProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const create = useCreateItem();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ItemKind>('quiz');
  const [componentId, setComponentId] = useState<string | null>(initialComponentId);
  const [date, setDate] = useState<ISODate>(today);
  const [score, setScore] = useState('');
  const [points, setPoints] = useState('');
  const [weight, setWeight] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const clearError = (field: keyof FieldErrors) => setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = () => {
    const next: FieldErrors = {};
    const name = title.trim();
    if (!name) next.title = 'Give it a name, like “Quiz 4”.';
    const scoreValue = parseDecimal(score);
    const pointsValue = parseDecimal(points);
    const weightValue = componentId === null ? parseDecimal(weight) : null;
    if (scoreValue !== null && Number.isNaN(scoreValue)) next.score = 'Use a number like 18.5.';
    if (pointsValue !== null && (Number.isNaN(pointsValue) || pointsValue <= 0)) next.points = 'Use a number above 0.';
    const scoreOk = scoreValue !== null && !Number.isNaN(scoreValue);
    if (scoreOk && pointsValue === null && scoreValue > MAX_ENTRY_PERCENT) {
      next.score = `Without “Out of”, the score is a percent — ${MAX_ENTRY_PERCENT} at most.`;
    }
    if (scoreOk && pointsValue !== null && !next.points && (scoreValue / pointsValue) * 100 > MAX_ENTRY_PERCENT) {
      next.score = `That's over ${MAX_ENTRY_PERCENT}% of the points. Check the numbers.`;
    }
    if (weightValue !== null && (Number.isNaN(weightValue) || weightValue > 100)) next.weight = 'Use a percent from 0 to 100.';
    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }

    const graded = scoreValue !== null;
    const row: NewRow<'items'> = {
      course_id: courseId,
      component_id: componentId,
      title: name,
      kind,
      due_date: date,
      score: scoreValue,
      points_possible: pointsValue,
      weight_override: weightValue,
      is_major: kind === 'exam' || kind === 'paper',
      source: 'manual',
      status: graded ? 'done' : 'todo',
      completed_at: graded ? new Date().toISOString() : null,
    };
    create.mutate(row, {
      onSuccess: (item) => {
        toast.show({ tone: 'success', title: 'Added', message: `${item.title} is in your grade tracker.` });
        onClose();
      },
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't add it", message: errorMessage(error) }),
    });
  };

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <NBText variant="h3">Add graded work</NBText>
          <NBText variant="small" color="muted">
            For anything the syllabus didn&apos;t list. Leave the score empty if it isn&apos;t back yet.
          </NBText>
        </View>

        <TextField
          label="Name"
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            clearError('title');
          }}
          placeholder="Quiz 4"
          autoFocus
          returnKeyType="next"
          error={errors.title}
        />

        <View style={{ gap: spacing.sm }}>
          <NBText variant="label" color="muted">
            Kind
          </NBText>
          <View accessibilityRole="radiogroup" accessibilityLabel="Kind" style={[styles.wrap, { gap: spacing.sm }]}>
            {KINDS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                role="radio"
                selected={kind === option.value}
                onPress={() => setKind(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <NBText variant="label" color="muted">
            Counts toward
          </NBText>
          <View accessibilityRole="radiogroup" accessibilityLabel="Counts toward" style={[styles.wrap, { gap: spacing.sm }]}>
            {components.map((component) => (
              <Chip
                key={component.id}
                label={`${component.name} · ${formatWeight(component.weight)}`}
                role="radio"
                selected={componentId === component.id}
                onPress={() => setComponentId(component.id)}
              />
            ))}
            <Chip
              label={components.length > 0 ? 'Its own weight' : 'Set a weight'}
              role="radio"
              selected={componentId === null}
              onPress={() => setComponentId(null)}
            />
          </View>
        </View>

        {componentId === null ? (
          <TextField
            label="Worth (% of grade)"
            value={weight}
            onChangeText={(text) => {
              setWeight(text);
              clearError('weight');
            }}
            keyboardType="decimal-pad"
            placeholder="5"
            helper="Leave empty if it doesn't count toward the grade."
            error={errors.weight}
          />
        ) : null}

        <View style={[styles.row, { gap: spacing.md }]}>
          <TextField
            label="Score"
            value={score}
            onChangeText={(text) => {
              setScore(text);
              clearError('score');
            }}
            keyboardType="decimal-pad"
            placeholder="18"
            error={errors.score}
            containerStyle={styles.flex}
          />
          <TextField
            label="Out of"
            value={points}
            onChangeText={(text) => {
              setPoints(text);
              clearError('points');
              clearError('score');
            }}
            keyboardType="decimal-pad"
            placeholder="20"
            error={errors.points}
            containerStyle={styles.flex}
          />
        </View>
        <NBText variant="small" color="muted">
          Leave “Out of” empty to type the score as a percent.
        </NBText>

        <DateField label="Date" value={date} onChange={setDate} />

        <View style={[styles.wrap, { gap: spacing.sm }]}>
          <Button label="Add to tracker" onPress={submit} loading={create.isPending} />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={create.isPending} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
