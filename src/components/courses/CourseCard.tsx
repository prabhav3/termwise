import { StyleSheet, View } from 'react-native';

import { Card, Icon, NBText } from '@/components/ui';
import { describeDue, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Course, Item } from '@/types/db';

export interface CourseCardProps {
  course: Course;
  nextItem: Item | null;
  highImpactCount: number;
  today: ISODate;
  onPress: () => void;
}

/** A course as a flat block of its color: code, title, next deadline, high-impact count. */
export function CourseCard({ course, nextItem, highImpactCount, today, onPress }: CourseCardProps) {
  const { spacing } = useTheme();
  const next = nextItem?.due_date ? `${nextItem.title} · ${describeDue(nextItem.due_date, today).label}` : null;
  const spoken = [
    course.code,
    course.title,
    course.archived ? 'archived' : null,
    next ? `Next: ${next}` : 'Nothing due soon',
    highImpactCount > 0 ? `${highImpactCount} high-impact deadline${highImpactCount === 1 ? '' : 's'} ahead` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card color={course.color} onPress={onPress} accessibilityLabel={spoken} accessibilityHint="Opens the course">
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.flex, { gap: spacing.xs }]}>
          {course.code || course.archived ? (
            <NBText variant="label" color="muted" dense numberOfLines={1}>
              {[course.code, course.archived ? 'Archived' : null].filter(Boolean).join(' · ')}
            </NBText>
          ) : null}
          <NBText variant="h2" numberOfLines={2}>
            {course.title}
          </NBText>
          <NBText variant="smallBold" color="muted" numberOfLines={2} style={{ marginTop: spacing.xs }}>
            {next ? `Next: ${next}` : 'Nothing due soon'}
          </NBText>
        </View>
        {highImpactCount > 0 ? (
          <View style={styles.stat}>
            <NBText variant="number" dense>
              {String(highImpactCount)}
            </NBText>
            <View style={[styles.statLabel, { gap: 2 }]}>
              <Icon name="star.fill" fallback="★" size={12} />
              <NBText variant="label" dense>
                High impact
              </NBText>
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  stat: { alignItems: 'center', minWidth: 72 },
  statLabel: { flexDirection: 'row', alignItems: 'center' },
});
