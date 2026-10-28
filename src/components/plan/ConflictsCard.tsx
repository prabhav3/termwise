import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, ListRow, NBText } from '@/components/ui';
import type { AnnotatedItem, CalendarConflict, EngineCourse } from '@/engine';
import { formatShortDate } from '@/lib/dates';
import { useTheme } from '@/theme';

import { courseName } from './labels';

const COLLAPSED = 3;

const KIND_TITLE: Record<CalendarConflict['kind'], string> = {
  same_day_majors: 'Same-day majors',
  due_on_holiday: 'Due during a break',
  outside_course_dates: 'Outside course dates',
  unscheduled: 'No due date',
};

export interface ConflictsCardProps {
  conflicts: readonly CalendarConflict[];
  onOpenItem: (itemId: string) => void;
}

/** Dates worth double-checking: same-day majors, deadlines on holidays, dates outside a course. */
export function ConflictsCard({ conflicts, onOpenItem }: ConflictsCardProps) {
  const { spacing } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (conflicts.length === 0) return null;
  const shown = expanded ? conflicts : conflicts.slice(0, COLLAPSED);

  return (
    <Card color="surfaceAlt" shadow="sm" style={{ gap: spacing.xs }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={18} />
        <NBText variant="h3" style={styles.grow}>
          {`${conflicts.length} ${conflicts.length === 1 ? 'date' : 'dates'} worth a check`}
        </NBText>
      </View>
      {shown.map((conflict, index) => (
        <ListRow
          key={`${conflict.kind}:${conflict.date ?? 'none'}:${conflict.item_ids.join(',')}`}
          title={`${KIND_TITLE[conflict.kind]}${conflict.date ? ` · ${formatShortDate(conflict.date)}` : ''}`}
          subtitle={conflict.message}
          divider={index > 0}
          onPress={conflict.item_ids[0] ? () => onOpenItem(conflict.item_ids[0]) : undefined}
          accessibilityHint="Opens the assignment"
        />
      ))}
      {conflicts.length > COLLAPSED ? (
        <Button
          label={expanded ? 'Show fewer' : `Show all ${conflicts.length}`}
          variant="ghost"
          size="sm"
          onPress={() => setExpanded((value) => !value)}
        />
      ) : null}
    </Card>
  );
}

export interface UnscheduledCardProps {
  conflict: CalendarConflict | null;
  items: Map<string, AnnotatedItem>;
  courses: Map<string, EngineCourse>;
  onOpenItem: (itemId: string) => void;
}

/** Items with no due date yet — they can't be planned until they get one. */
export function UnscheduledCard({ conflict, items, courses, onOpenItem }: UnscheduledCardProps) {
  const { spacing } = useTheme();
  if (!conflict) return null;
  const rows = conflict.item_ids
    .map((id) => items.get(id))
    .filter((item): item is AnnotatedItem => item !== undefined && courses.get(item.course_id)?.archived !== true);
  if (rows.length === 0) return null;

  return (
    <Card shadow="sm" style={{ gap: spacing.xs }}>
      <NBText variant="h3">No due date yet</NBText>
      <NBText variant="small" color="muted">
        These can&apos;t be planned until they have a date. Add one and Termwise fits them in.
      </NBText>
      {rows.map((item, index) => (
        <ListRow
          key={item.id}
          title={item.title}
          subtitle={courseName(courses.get(item.course_id))}
          divider={index > 0}
          onPress={() => onOpenItem(item.id)}
          accessibilityHint="Opens the assignment to add a date"
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
});
