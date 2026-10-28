import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { CanvasCourseSummary, CanvasImportResponse } from '@shared/api.ts';

import {
  Button,
  Card,
  Chip,
  CourseTag,
  ErrorBanner,
  Icon,
  ListRow,
  LoadingBlock,
  NBText,
  Toggle,
  useToast,
} from '@/components/ui';
import { useActiveTerm, useCanvasImport, useCourses } from '@/data';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';
import type { Course } from '@/types/db';

import { Panel } from './common';
import { suggestCourse } from './courseMatch';
import { plural } from './format';

const NEW_COURSE = 'new';

interface Choice {
  selected: boolean;
  /** NEW_COURSE or an existing Termwise course id to merge into. */
  target: string;
}

function initialChoices(courses: readonly CanvasCourseSummary[], existing: readonly Course[]): Record<string, Choice> {
  const choices: Record<string, Choice> = {};
  for (const course of courses) {
    if (course.linked_course_id) continue;
    const match = suggestCourse(course, existing);
    choices[course.external_id] = { selected: true, target: match?.course.id ?? NEW_COURSE };
  }
  return choices;
}

function Checkbox({ checked }: { checked: boolean }) {
  const { colors, borders, radius } = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: borders.standard,
        borderColor: colors.border,
        borderRadius: radius.control / 2,
        backgroundColor: checked ? colors.yellow : colors.surface,
      }}
    >
      {checked ? <Icon name="checkmark" fallback="✓" size={16} weight="heavy" color={colors.onAccent} /> : null}
    </View>
  );
}

function CourseChoice({
  course,
  choice,
  candidates,
  suggestedId,
  onChange,
}: {
  course: CanvasCourseSummary;
  choice: Choice;
  candidates: readonly Course[];
  suggestedId: string | null;
  onChange: (choice: Choice) => void;
}) {
  const { colors, spacing, borders } = useTheme();
  const meta = [course.course_code, course.term_name].filter(Boolean).join(' · ');
  const ordered = suggestedId
    ? [...candidates.filter((c) => c.id === suggestedId), ...candidates.filter((c) => c.id !== suggestedId)]
    : candidates;

  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: borders.hairline, borderTopColor: colors.border }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: choice.selected }}
        accessibilityLabel={`${course.name}${meta ? `, ${meta}` : ''}`}
        onPress={() => {
          haptic('selection');
          onChange({ ...choice, selected: !choice.selected });
        }}
        style={[styles.row, { gap: spacing.md, minHeight: 44 }]}
      >
        <Checkbox checked={choice.selected} />
        <View style={styles.flex}>
          <NBText variant="bodyBold" dense numberOfLines={2}>
            {course.name}
          </NBText>
          {meta ? (
            <NBText variant="small" color="muted" dense numberOfLines={1}>
              {meta}
            </NBText>
          ) : null}
        </View>
      </Pressable>
      {choice.selected ? (
        <View style={{ gap: spacing.xs, paddingLeft: 28 + spacing.md }}>
          <NBText variant="label" color="muted">
            Import as
          </NBText>
          <View style={[styles.wrap, { gap: spacing.sm }]}>
            <Chip
              role="radio"
              label="New course"
              selected={choice.target === NEW_COURSE}
              onPress={() => onChange({ ...choice, target: NEW_COURSE })}
            />
            {ordered.map((candidate) => (
              <Chip
                key={candidate.id}
                role="radio"
                label={`Link to ${candidate.code ?? candidate.title}${candidate.id === suggestedId ? ' · best match' : ''}`}
                accessibilityLabel={`Link to ${candidate.title}${candidate.id === suggestedId ? ', best match' : ''}`}
                selected={choice.target === candidate.id}
                onPress={() => onChange({ ...choice, target: candidate.id })}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Results({
  response,
  names,
  onDone,
}: {
  response: CanvasImportResponse;
  names: ReadonlyMap<string, string>;
  onDone: () => void;
}) {
  const { spacing } = useTheme();
  const courses = useCourses({ includeArchived: true });
  return (
    <Panel eyebrow="Imported" title="You're all set">
      {response.imported.map((row, index) => {
        const course = courses.data?.find((c) => c.id === row.course_id);
        return (
          <ListRow
            key={row.external_id}
            divider={index > 0}
            title={course?.title ?? names.get(row.external_id) ?? 'Course'}
            subtitle={`${plural(row.items_created, 'new item')} · ${plural(row.items_updated, 'update')}${
              row.components_created > 0 ? ` · ${plural(row.components_created, 'grade category', 'grade categories')}` : ''
            }`}
            left={course ? <CourseTag course={course} /> : undefined}
            onPress={() => router.push(`/course/${row.course_id}`)}
          />
        );
      })}
      {response.discrepancies_open > 0 ? (
        <Card color="orange" shadow="sm" style={{ gap: spacing.sm }}>
          <NBText variant="bodyBold">
            {`${plural(response.discrepancies_open, 'difference')} between Canvas and your syllabi`}
          </NBText>
          <NBText variant="small">Check them so your plan uses the right dates.</NBText>
          <Button label="Review differences" variant="secondary" size="sm" onPress={() => router.push('/discrepancies')} />
        </Card>
      ) : null}
      <Button label="Done" fullWidth onPress={onDone} />
    </Panel>
  );
}

export interface CanvasCoursePickerProps {
  connectionId: string;
  courses: readonly CanvasCourseSummary[];
  onDone: () => void;
  onCancel?: () => void;
}

/** Pick Canvas courses to import; each becomes a new Termwise course or merges into an existing one. */
export function CanvasCoursePicker({ connectionId, courses, onDone, onCancel }: CanvasCoursePickerProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const existing = useCourses();
  const activeTerm = useActiveTerm();
  const importCourses = useCanvasImport();
  const [includeScores, setIncludeScores] = useState(true);
  const [choices, setChoices] = useState<Record<string, Choice> | null>(null);

  if (existing.isPending) return <LoadingBlock lines={4} label="Loading your courses" />;

  const termwiseCourses = existing.data ?? [];
  const candidates = termwiseCourses.filter((course) => course.canvas_course_id === null);
  const current = choices ?? initialChoices(courses, candidates);
  const available = courses.filter((course) => !course.linked_course_id);
  const already = courses.filter((course) => course.linked_course_id);
  const picked = available.filter((course) => current[course.external_id]?.selected);
  const names = new Map(courses.map((course) => [course.external_id, course.name]));

  if (importCourses.data) {
    return <Results response={importCourses.data} names={names} onDone={onDone} />;
  }

  const setChoice = (externalId: string, choice: Choice) => setChoices({ ...current, [externalId]: choice });

  const submit = () =>
    importCourses.mutate(
      {
        connection_id: connectionId,
        include_scores: includeScores,
        courses: picked.map((course) => {
          const target = current[course.external_id]?.target ?? NEW_COURSE;
          return target === NEW_COURSE
            ? { external_id: course.external_id, link_course_id: null, term_id: activeTerm.data?.id ?? null }
            : { external_id: course.external_id, link_course_id: target };
        }),
      },
      {
        onSuccess: (response) =>
          toast.show({ tone: 'success', title: 'Canvas imported', message: `${plural(response.imported.length, 'course')} added to your plan.` }),
      },
    );

  if (importCourses.isPending) {
    return (
      <Panel eyebrow="Canvas" title={`Importing ${plural(picked.length, 'course')}…`}>
        <LoadingBlock lines={4} label="Importing from Canvas" />
        <NBText variant="small" color="muted">
          Pulling assignments, due dates and grade weights. Big courses can take a minute — keep the app open.
        </NBText>
      </Panel>
    );
  }

  return (
    <Panel eyebrow="Canvas" title="Choose your courses">
      <NBText variant="body" color="muted">
        Already uploaded a syllabus? Link it, and Canvas fills in what the syllabus left out — your syllabus dates
        stay in charge.
      </NBText>

      {available.length === 0 ? (
        <NBText variant="bodyMedium">Every active Canvas course is already in Termwise.</NBText>
      ) : (
        <View>
          {available.map((course) => {
            const choice = current[course.external_id] ?? { selected: false, target: NEW_COURSE };
            return (
              <CourseChoice
                key={course.external_id}
                course={course}
                choice={choice}
                candidates={candidates}
                suggestedId={suggestCourse(course, candidates)?.course.id ?? null}
                onChange={(next) => setChoice(course.external_id, next)}
              />
            );
          })}
        </View>
      )}

      {already.length > 0 ? (
        <NBText variant="small" color="muted">
          {`Already imported: ${already.map((course) => course.course_code ?? course.name).join(', ')}`}
        </NBText>
      ) : null}

      <ListRow
        title="Import my Canvas scores"
        subtitle="Fills the grade tracker with grades Canvas already has."
        right={<Toggle value={includeScores} onValueChange={setIncludeScores} accessibilityLabel="Import my Canvas scores" />}
      />

      {importCourses.error ? <ErrorBanner title="Import didn't finish" message={errorMessage(importCourses.error)} /> : null}

      <View style={[styles.row, { gap: spacing.md }]}>
        {onCancel ? <Button label="Not now" variant="secondary" onPress={onCancel} /> : null}
        <Button
          label={picked.length > 0 ? `Import ${plural(picked.length, 'course')}` : 'Pick a course'}
          disabled={picked.length === 0}
          onPress={submit}
          style={styles.flex}
          fullWidth
        />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
