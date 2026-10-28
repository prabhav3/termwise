// "What if?": a hypothetical percent for every ungraded item; the simulated final grade and
// letter update live. Nothing here is saved.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, NBText } from '@/components/ui';
import { simulateGrade, type CourseGrade, type EngineComponent, type EngineCourse } from '@/engine';
import { describeDue, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { GradeHeadline } from './GradeHeadline';
import { GradeSlider } from './GradeSlider';
import { defaultHypotheticals, formatGrade, formatWeight, itemWeight } from './model';

export interface ScenarioSimulatorProps {
  course: EngineCourse;
  components: EngineComponent[];
  items: Item[];
  grade: CourseGrade;
  /** Ungraded items that can still move the grade. */
  candidates: Item[];
  today: ISODate;
}

function deltaNote(simulated: number | null, current: number | null): string | null {
  if (simulated === null) return null;
  if (current === null) return 'Your first look at this course';
  const delta = Math.round((simulated - current) * 10) / 10;
  if (Math.abs(delta) < 0.05) return 'Same as your grade now';
  return `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta).toFixed(1)} points from now (${formatGrade(current)})`;
}

export function ScenarioSimulator({ course, components, items, grade, candidates, today }: ScenarioSimulatorProps) {
  const { spacing } = useTheme();
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  if (candidates.length === 0) {
    return (
      <Card color="surfaceAlt" shadow="none">
        <View style={{ gap: spacing.sm }}>
          <NBText variant="h3">Nothing to simulate</NBText>
          <NBText variant="body" color="muted">
            {grade.totalWeight > 0
              ? 'Everything that counts toward this grade already has a score.'
              : 'Add grading weights for this course, then try out scores for what is left.'}
          </NBText>
        </View>
      </Card>
    );
  }

  const defaults = defaultHypotheticals(candidates, grade, course);
  const values: Record<string, number> = {};
  for (const item of candidates) values[item.id] = overrides[item.id] ?? defaults[item.id];
  const simulated = simulateGrade(course, components, items, values);
  const changed = candidates.some((item) => overrides[item.id] !== undefined && overrides[item.id] !== defaults[item.id]);
  const emptyCategories = grade.components.filter(
    (entry) => entry.weight > 0 && entry.totalCount === 0 && components.some((component) => component.id === entry.component_id),
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <Card>
        <View style={{ gap: spacing.md }}>
          <GradeHeadline
            caption="Final grade if these land"
            percent={simulated.percent}
            letter={simulated.letter}
            letterColor={course.color}
            size="hero"
            note={deltaNote(simulated.percent, grade.percent)}
          />
          <View style={[styles.row, { gap: spacing.sm }]}>
            <NBText variant="small" color="muted" style={styles.flex}>
              A what-if only — nothing here is saved. Sliders start at your current average.
            </NBText>
            <Button
              label="Reset"
              size="sm"
              variant="secondary"
              disabled={!changed}
              accessibilityHint="Puts every slider back to your current average"
              onPress={() => setOverrides({})}
            />
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.lg }}>
          {candidates.map((item) => {
            const weight = itemWeight(item, components, items);
            const value = values[item.id];
            const details = [
              item.due_date ? describeDue(item.due_date, today).label : null,
              weight !== null ? `${formatWeight(weight)} of grade` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={item.id} style={{ gap: spacing.xs }}>
                <View style={[styles.row, { gap: spacing.sm }]} accessible={false}>
                  <View style={styles.flex}>
                    <NBText variant="bodyBold" numberOfLines={2} dense>
                      {item.title}
                    </NBText>
                    {details ? (
                      <NBText variant="small" color="muted" dense>
                        {details}
                      </NBText>
                    ) : null}
                  </View>
                  <NBText variant="h3" dense accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {`${value}%`}
                  </NBText>
                </View>
                <GradeSlider
                  label={`${item.title} score`}
                  value={value}
                  onChange={(next) => setOverrides((current) => ({ ...current, [item.id]: next }))}
                />
              </View>
            );
          })}
        </View>
      </Card>

      {emptyCategories.length > 0 ? (
        <NBText variant="small" color="muted">
          {`${emptyCategories.map((entry) => `${entry.name} (${formatWeight(entry.weight)})`).join(', ')} ${
            emptyCategories.length === 1 ? 'has' : 'have'
          } nothing listed yet, so ${emptyCategories.length === 1 ? "it isn't" : "they aren't"} part of this what-if.`}
        </NBText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
