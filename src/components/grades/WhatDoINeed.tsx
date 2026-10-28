// "What do I need on the final?" — pick the assignment, the goal (letter or percent), and what
// to assume for everything else; the needed score shows huge, colored by how feasible it is.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Icon, NBText, SegmentedControl, Stepper, useToast } from '@/components/ui';
import { useUpdateCourse } from '@/data/courses';
import {
  requiredScore,
  type CourseGrade,
  type EngineComponent,
  type EngineCourse,
  type OtherWorkAssumption,
} from '@/engine';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { describeDue, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { ItemPickerSheet } from './ItemPickerSheet';
import {
  defaultTargetItem,
  defaultTargetPercent,
  FEASIBILITY_COPY,
  feasibilityOf,
  formatNeeded,
  formatWeight,
  itemWeight,
  letterForCourse,
  targetCutoffs,
} from './model';

export interface WhatDoINeedProps {
  course: EngineCourse;
  components: EngineComponent[];
  /** Every item of the course (graded and not). */
  items: Item[];
  grade: CourseGrade;
  /** Ungraded items that can still move the grade. */
  candidates: Item[];
  today: ISODate;
  onEditWeights: () => void;
}

const ASSUMPTIONS = [
  { value: 'current_average', label: 'My average' },
  { value: 'zero', label: 'Zeros' },
  { value: 'perfect', label: 'Full marks' },
] as const;

export function WhatDoINeed({ course, components, items, grade, candidates, today, onEditWeights }: WhatDoINeedProps) {
  const { colors, borders, radius, spacing, type } = useTheme();
  const toast = useToast();
  const updateCourse = useUpdateCourse();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [target, setTarget] = useState<number>(() => defaultTargetPercent(course, grade));
  const [assume, setAssume] = useState<OtherWorkAssumption>('current_average');
  const [picking, setPicking] = useState(false);

  if (candidates.length === 0) {
    const noWeights = !(grade.totalWeight > 0);
    return (
      <Card color="surfaceAlt" shadow="none">
        <View style={{ gap: spacing.sm }}>
          <NBText variant="h3">{noWeights ? 'Add grading weights first' : 'Nothing left to aim for'}</NBText>
          <NBText variant="body" color="muted">
            {noWeights
              ? 'Tell Termwise how the course is graded (e.g. Exams 50%, Homework 30%) and this works out what you need.'
              : 'Everything that counts toward this grade already has a score. Nice.'}
          </NBText>
          {noWeights ? <Button label="Add weights" variant="secondary" size="sm" onPress={onEditWeights} /> : null}
        </View>
      </Card>
    );
  }

  const selected = candidates.find((item) => item.id === pickedId) ?? defaultTargetItem(candidates) ?? candidates[0];
  const result = requiredScore(course, components, items, selected.id, target, assume);
  const feasibility = feasibilityOf(result);
  const copy = FEASIBILITY_COPY[feasibility];
  const weight = itemWeight(selected, components, items);
  const cutoffs = targetCutoffs(course);
  const targetLetter = letterForCourse(target, course);
  const savedTarget = course.target_percent !== null ? Number(course.target_percent) : null;
  const choices = candidates.map((item) => ({ item, weight: itemWeight(item, components, items) }));
  const selectedDetails = [
    selected.due_date ? describeDue(selected.due_date, today).label : null,
    weight !== null ? `${formatWeight(weight)} of grade` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const hugeStyle = {
    fontSize: (type.number.fontSize ?? 34) * 2,
    lineHeight: (type.number.lineHeight ?? 38) * 1.9,
  };

  const saveTarget = () => {
    updateCourse.mutate(
      { id: course.id, changes: { target_percent: target } },
      {
        onSuccess: () =>
          toast.show({ tone: 'success', title: 'Target saved', message: `Aiming for ${formatWeight(target)}${targetLetter ? ` (${targetLetter})` : ''}.` }),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't save the target", message: errorMessage(error) }),
      },
    );
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <NBText variant="label" color="muted">
          On which assignment
        </NBText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Assignment: ${selected.title}${selectedDetails ? `, ${selectedDetails}` : ''}`}
          accessibilityHint={choices.length > 1 ? 'Choose a different assignment' : undefined}
          disabled={choices.length < 2}
          onPress={() => {
            haptic('selection');
            setPicking(true);
          }}
          style={({ pressed }) => [
            styles.picker,
            {
              gap: spacing.md,
              padding: spacing.md,
              backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
              borderColor: colors.border,
              borderWidth: borders.standard,
              borderRadius: radius.control,
            },
          ]}
        >
          <View style={styles.flex}>
            <NBText variant="bodyBold" numberOfLines={2} dense>
              {selected.title}
            </NBText>
            {selectedDetails ? (
              <NBText variant="small" color="muted" dense>
                {selectedDetails}
              </NBText>
            ) : null}
          </View>
          {choices.length > 1 ? (
            <View style={[styles.change, { gap: spacing.xs }]}>
              <NBText variant="smallBold" color="primary">
                Change
              </NBText>
              <Icon name="chevron.down" fallback="⌄" size={14} color={colors.primary} />
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={{ gap: spacing.sm }}>
        <NBText variant="label" color="muted">
          Your goal for the course
        </NBText>
        {cutoffs.length > 0 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Target letter grade" style={[styles.wrap, { gap: spacing.sm }]}>
            {cutoffs.map((cutoff) => (
              <Chip
                key={`${cutoff.letter}-${cutoff.min}`}
                label={cutoff.letter}
                accessibilityLabel={`${cutoff.letter}, ${formatWeight(cutoff.min)} or higher`}
                role="radio"
                selected={Math.abs(target - cutoff.min) < 1e-6}
                onPress={() => setTarget(cutoff.min)}
              />
            ))}
          </View>
        ) : null}
        <Stepper
          label="Target percent"
          value={Math.round(target)}
          onChange={setTarget}
          min={1}
          max={100}
          format={(value) => `${value}%`}
          unit={targetLetter ? `${targetLetter} for the course` : undefined}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <NBText variant="label" color="muted">
          For your other ungraded work, assume
        </NBText>
        <SegmentedControl<OtherWorkAssumption>
          options={ASSUMPTIONS}
          value={assume}
          onChange={setAssume}
          accessibilityLabel="What to assume for your other ungraded work"
        />
      </View>

      <Card color={copy.tone ?? 'surfaceAlt'} shadow="lg">
        <View
          accessible
          accessibilityLabel={`You need ${result.neededPercent === null ? 'an unknown score' : formatNeeded(result.neededPercent).replace('%', ' percent')} on ${selected.title}. ${copy.label}. ${result.explanation}`}
          style={{ gap: spacing.sm }}
        >
          <View style={[styles.verdict, { gap: spacing.sm }]}>
            <NBText variant="label" style={styles.flex}>
              {result.alreadySecured ? 'You need at least' : 'You need'}
            </NBText>
            <Badge label={copy.label} tone="ink" accessibilityLabel={copy.label} />
          </View>
          <NBText variant="number" style={hugeStyle} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
            {formatNeeded(result.neededPercent)}
          </NBText>
          <NBText variant="bodyBold">{`on ${selected.title}`}</NBText>
          <NBText variant="body">{result.explanation}</NBText>
        </View>
      </Card>

      {savedTarget === null || Math.abs(savedTarget - target) > 1e-6 ? (
        <Button
          label={`Make ${formatWeight(target)} my course target`}
          variant="secondary"
          onPress={saveTarget}
          loading={updateCourse.isPending}
          fullWidth
        />
      ) : (
        <NBText variant="small" color="muted" align="center">
          {`${formatWeight(target)} is your saved target for this course.`}
        </NBText>
      )}

      <ItemPickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        items={choices}
        selectedId={selected.id}
        onSelect={setPickedId}
        today={today}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  picker: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  change: { flexDirection: 'row', alignItems: 'center' },
  verdict: { flexDirection: 'row', alignItems: 'center' },
});
