import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip, NBText } from '@/components/ui';
import type { CalendarFilters as Filters } from '@/data/plan-views';
import type { EngineCourse } from '@/engine';
import { useTheme } from '@/theme';

import { courseName } from './labels';

export interface CalendarFiltersProps {
  courses: readonly EngineCourse[];
  value: Filters;
  onChange: (next: Filters) => void;
}

/** Course chips (none selected = every course) and a "majors only" switch. */
export function CalendarFilters({ courses, value, onChange }: CalendarFiltersProps) {
  const { spacing } = useTheme();
  const all = value.courseIds.length === 0;

  const toggleCourse = (id: string) => {
    const selected = value.courseIds.includes(id);
    const courseIds = selected ? value.courseIds.filter((existing) => existing !== id) : [...value.courseIds, id];
    // Picking every course is the same as "All courses".
    onChange({ ...value, courseIds: courseIds.length === courses.length ? [] : courseIds });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <NBText variant="label" color="muted">
        Show
      </NBText>
      {courses.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel="Filter by course"
          contentContainerStyle={[styles.row, { gap: spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.xs }]}
        >
          <Chip
            label="All courses"
            selected={all}
            role="radio"
            onPress={() => onChange({ ...value, courseIds: [] })}
          />
          {courses.map((course) => (
            <Chip
              key={course.id}
              label={courseName(course)}
              accessibilityLabel={`${course.title}${course.code ? `, ${course.code}` : ''}`}
              selected={!all && value.courseIds.includes(course.id)}
              onPress={() => toggleCourse(course.id)}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Chip
          label="Majors only"
          accessibilityLabel="Major deadlines only"
          selected={value.majorsOnly}
          onPress={() => onChange({ ...value, majorsOnly: !value.majorsOnly })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
