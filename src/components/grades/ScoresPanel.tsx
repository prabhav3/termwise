// Categories with their weights, percents and dropped items; every gradeable item with inline
// score entry; and a way to add graded work the syllabus didn't list.
import { useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Button, EmptyState, SectionHeader, useToast } from '@/components/ui';
import { useSaveScore } from '@/data/grades';
import type { CourseGrade, EngineCourse } from '@/engine';
import { errorMessage } from '@/lib/functions';
import type { ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { GradingComponent, Item } from '@/types/db';

import { AddGradedItemForm } from './AddGradedItemForm';
import { GradeGroupCard, groupMeta } from './GradeGroupCard';
import { buildGradeGroups, itemWeight, type GradeGroup } from './model';

export interface ScoresPanelProps {
  course: EngineCourse;
  /** This course's categories, in display order. */
  components: GradingComponent[];
  /** This course's items. */
  items: Item[];
  grade: CourseGrade;
  today: ISODate;
  onEditWeights: () => void;
}

/** Weighted average of self-weighted items that have a score. */
function standalonePercent(groups: GradeGroup<Item>[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const group of groups) {
    if (group.percent === null || group.weight === null || group.weight <= 0) continue;
    sum += group.percent * group.weight;
    weight += group.weight;
  }
  return weight > 0 ? sum / weight : null;
}

export function ScoresPanel({ course, components, items, grade, today, onEditWeights }: ScoresPanelProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const save = useSaveScore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ componentId: string | null } | null>(null);

  const groups = buildGradeGroups(course.id, components, items, grade);
  const categories = groups.filter((group) => group.kind === 'component');
  const standalone = groups.filter((group) => group.kind === 'standalone');
  const uncounted = groups.find((group) => group.kind === 'uncounted');

  const rowsFor = (group: GradeGroup<Item>) =>
    group.items.map((item) => ({ item, weight: itemWeight(item, components, items), dropped: group.droppedIds.has(item.id) }));

  const onSave = (item: Item, score: number | null, pointsPossible: number | null) => {
    setEditingId(null);
    AccessibilityInfo.announceForAccessibility(score === null ? `Score cleared for ${item.title}` : `Score saved for ${item.title}`);
    save.mutateAsync({ item, score, pointsPossible }).catch((error: unknown) => {
      toast.show({ tone: 'danger', title: "Score didn't save", message: `${item.title}: ${errorMessage(error)}` });
    });
  };

  const startAdding = (componentId: string | null) => {
    setEditingId(null);
    setAdding({ componentId });
  };

  const shared = { today, editingId, onEdit: setEditingId, onSave };
  const nothingYet = groups.length === 0;

  return (
    <View style={{ gap: spacing.lg }}>
      <SectionHeader
        title="Scores"
        actionLabel={components.length > 0 ? 'Edit weights' : 'Add weights'}
        onAction={onEditWeights}
        style={{ marginTop: 0, marginBottom: 0 }}
      />

      {nothingYet && !adding ? (
        <EmptyState
          tone="blue"
          title="No graded work yet"
          message="Scores from Canvas show up here by themselves. Or add a quiz, lab or exam and type the score in."
          actionLabel="Add graded work"
          onAction={() => startAdding(components[0]?.id ?? null)}
        />
      ) : null}

      {categories.map((group) => (
        <GradeGroupCard
          key={group.key}
          title={group.title}
          meta={groupMeta(group)}
          percent={group.percent}
          rows={rowsFor(group)}
          missing={group.missing}
          onAddMissing={() => startAdding(group.componentId)}
          {...shared}
        />
      ))}

      {standalone.length > 0 ? (
        <GradeGroupCard
          title="Weighted on their own"
          meta={`${standalone.length} ${standalone.length === 1 ? 'item' : 'items'} with their own share of the grade`}
          percent={standalonePercent(standalone)}
          rows={standalone.flatMap(rowsFor)}
          missing={0}
          {...shared}
        />
      ) : null}

      {uncounted ? (
        <GradeGroupCard
          title="Not counted yet"
          meta={null}
          percent={null}
          note="These aren't in a weighted category, so they don't change your grade. Link them to a category by editing the item, or set the weights."
          rows={rowsFor(uncounted)}
          missing={0}
          {...shared}
        />
      ) : null}

      {adding ? (
        <AddGradedItemForm
          key={adding.componentId ?? 'none'}
          courseId={course.id}
          components={components}
          initialComponentId={adding.componentId}
          today={today}
          onClose={() => setAdding(null)}
        />
      ) : !nothingYet ? (
        <Button
          label="Add graded work"
          variant="secondary"
          icon={{ name: 'plus', fallback: '+' }}
          accessibilityHint="For a quiz or assignment the syllabus didn't list"
          onPress={() => startAdding(components[0]?.id ?? null)}
          fullWidth
        />
      ) : null}
    </View>
  );
}
