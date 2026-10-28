import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SyllabusExtraction } from '@shared/extraction.ts';

import { describeMeetings, FieldCell, FieldRow, MeetingFields, NumberField } from '@/components/courses/fields';
import { Button, Card, DateField, NBText, TextField } from '@/components/ui';
import { formatShortDate, formatTimeOfDay } from '@/lib/dates';
import { useTheme } from '@/theme';

type CourseInfo = SyllabusExtraction['course'];

export interface CourseInfoEditorProps {
  course: CourseInfo;
  onChange: (course: CourseInfo) => void;
  /** Term picker (or a note about the merge target's term). */
  termControl: ReactNode;
  titleError: string | null;
}

/** Course card: a calm summary with an Edit toggle that reveals every field. */
export function CourseInfoEditor({ course, onChange, termControl, titleError }: CourseInfoEditorProps) {
  const { spacing } = useTheme();
  const [editing, setEditing] = useState(titleError !== null || !course.title.trim());
  const set = (patch: Partial<CourseInfo>) => onChange({ ...course, ...patch });
  const meetings = describeMeetings(course.meeting_days, course.meeting_start, course.meeting_end, formatTimeOfDay);
  const dates =
    course.start_date && course.end_date
      ? `${formatShortDate(course.start_date)} – ${formatShortDate(course.end_date)}`
      : course.start_date
        ? `Starts ${formatShortDate(course.start_date)}`
        : null;
  const datesBackwards = course.start_date !== null && course.end_date !== null && course.end_date < course.start_date;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.flex, { gap: 2 }]}>
          {course.code || course.section ? (
            <NBText variant="label" color="muted">
              {[course.code, course.section ? `Section ${course.section}` : null].filter(Boolean).join(' · ')}
            </NBText>
          ) : null}
          <NBText variant="h2">{course.title.trim() || 'Untitled course'}</NBText>
          {[course.instructor, meetings, dates, course.credits !== null ? `${course.credits} credits` : null]
            .filter((line): line is string => Boolean(line))
            .map((line) => (
              <NBText key={line} variant="small" color="muted">
                {line}
              </NBText>
            ))}
        </View>
        <Button
          label={editing ? 'Done' : 'Edit'}
          size="sm"
          variant="secondary"
          onPress={() => setEditing((value) => !value)}
          accessibilityLabel={editing ? 'Done editing course details' : 'Edit course details'}
        />
      </View>

      {editing ? (
        <View style={{ gap: spacing.md }}>
          <TextField label="Course title" value={course.title} onChangeText={(title) => set({ title })} error={titleError} autoCapitalize="words" />
          <FieldRow>
            <FieldCell>
              <TextField
                label="Code"
                value={course.code ?? ''}
                placeholder="PSY 101"
                autoCapitalize="characters"
                onChangeText={(code) => set({ code: code || null })}
              />
            </FieldCell>
            <FieldCell>
              <TextField label="Section" value={course.section ?? ''} placeholder="02" onChangeText={(section) => set({ section: section || null })} />
            </FieldCell>
          </FieldRow>
          <TextField
            label="Instructor"
            value={course.instructor ?? ''}
            autoCapitalize="words"
            onChangeText={(instructor) => set({ instructor: instructor || null })}
          />
          <TextField
            label="Instructor email"
            value={course.instructor_email ?? ''}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(email) => set({ instructor_email: email || null })}
          />
          <FieldRow>
            <FieldCell flex={2}>
              <TextField label="Room" value={course.location ?? ''} onChangeText={(location) => set({ location: location || null })} />
            </FieldCell>
            <FieldCell>
              <NumberField label="Credits" value={course.credits} min={0} max={20} onChange={(credits) => set({ credits })} />
            </FieldCell>
          </FieldRow>
          <MeetingFields
            days={course.meeting_days}
            start={course.meeting_start}
            end={course.meeting_end}
            onChange={({ days, start, end }) => set({ meeting_days: days, meeting_start: start, meeting_end: end })}
          />
          <FieldRow>
            <FieldCell>
              <DateField label="First day" value={course.start_date} onChange={(start_date) => set({ start_date })} />
            </FieldCell>
            <FieldCell>
              <DateField
                label="Last day"
                value={course.end_date}
                onChange={(end_date) => set({ end_date })}
                error={datesBackwards ? 'Before the first day' : null}
              />
            </FieldCell>
          </FieldRow>
        </View>
      ) : null}
      {termControl}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});
