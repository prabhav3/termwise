// One course on the Grades tab. The whole card opens the grade tracker.
import { StyleSheet, View } from 'react-native';

import { Card, CourseTag, Icon, NBText } from '@/components/ui';
import type { CourseGrade, EngineCourse } from '@/engine';
import { useTheme } from '@/theme';

import { GradeOverview, gradeOverviewSpoken } from './GradeOverview';

export interface CourseGradeCardProps {
  course: EngineCourse;
  grade: CourseGrade;
  onPress: () => void;
}

export function CourseGradeCard({ course, grade, onPress }: CourseGradeCardProps) {
  const { colors, spacing } = useTheme();
  const name = course.code ? `${course.code}, ${course.title}` : course.title;

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${name}. ${gradeOverviewSpoken(course, grade)}`}
      accessibilityHint="Opens the grade tracker for this course"
    >
      <View style={{ gap: spacing.md }}>
        <View style={[styles.header, { gap: spacing.sm }]}>
          <View style={[styles.title, { gap: spacing.xs }]}>
            {course.code ? <CourseTag course={course} /> : null}
            <NBText variant="bodyBold" numberOfLines={2} dense>
              {course.title}
            </NBText>
          </View>
          <Icon name="chevron.right" fallback="›" size={16} color={colors.inkMuted} />
        </View>
        <GradeOverview course={course} grade={grade} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
});
