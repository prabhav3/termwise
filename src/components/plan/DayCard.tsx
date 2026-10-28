import { Pressable, StyleSheet, View } from 'react-native';

import { Card, CourseTag, Icon, NBText, Tag } from '@/components/ui';
import { isMajorDeadline, isOpenItem, type DayView } from '@/data/plan-views';
import type { AnnotatedItem, EngineCourse } from '@/engine';
import { formatShortDate, formatTimeOfDay, WEEKDAY_LONG, WEEKDAY_SHORT, weekdayISO } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { BlockLine } from './BlockLine';
import { DayLoadBar } from './DayLoadBar';
import { courseName, itemKindLabel } from './labels';
import { openItem } from './routes';

export interface DayCardProps {
  day: DayView;
  courses: Map<string, EngineCourse>;
  scale: number;
}

function DeadlineRow({ item, course, divider }: { item: AnnotatedItem; course: EngineCourse | undefined; divider: boolean }) {
  const { colors, borders, spacing } = useTheme();
  const open = isOpenItem(item);
  const major = isMajorDeadline(item);
  const time = item.due_time ? ` · ${formatTimeOfDay(item.due_time)}` : '';
  const spoken = `Due: ${item.title}, ${itemKindLabel(item.kind)}, ${courseName(course)}${time}${major ? ', major' : ''}${open ? '' : ', done'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the assignment"
      onPress={() => {
        haptic('selection');
        openItem(item.id);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          borderTopWidth: divider ? borders.hairline : 0,
          borderTopColor: colors.border,
          backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <Tag label="Due" color={major ? 'red' : 'yellow'} />
      <View style={styles.grow}>
        <NBText variant="bodyBold" style={open ? null : styles.struck} numberOfLines={2} dense>
          {item.title}
        </NBText>
        <View style={[styles.meta, { gap: spacing.sm }]}>
          {course ? <CourseTag course={course} /> : null}
          <NBText variant="tiny" color="muted" dense>
            {`${itemKindLabel(item.kind)}${time}${major ? ' · Major' : ''}${open ? '' : ' · Done'}`}
          </NBText>
        </View>
      </View>
      <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} />
    </Pressable>
  );
}

/** One day of the week view: load vs capacity, what's due, and the planned blocks. */
export function DayCard({ day, courses, scale }: DayCardProps) {
  const { spacing } = useTheme();
  const weekday = weekdayISO(day.date);
  const empty = day.blocks.length === 0 && day.deadlines.length === 0;

  return (
    <Card color={day.isToday ? 'surfaceAlt' : undefined} shadow={day.isPast ? 'sm' : 'md'} style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="h3" style={styles.grow}>
          {`${WEEKDAY_SHORT[weekday]} · ${formatShortDate(day.date)}`}
        </NBText>
        {day.isToday ? <Tag label="Today" color="yellow" /> : null}
        {day.load.overloaded ? <Tag label="Overloaded" color="orange" /> : null}
      </View>
      <DayLoadBar load={day.load} scale={scale} dayName={WEEKDAY_LONG[weekday]} />
      {empty ? (
        <NBText variant="small" color="muted">
          {day.load.isStudyDay ? 'Nothing planned. Breathing room.' : 'Rest day — nothing planned.'}
        </NBText>
      ) : (
        <View>
          {day.deadlines.map((item, index) => (
            <DeadlineRow key={item.id} item={item} course={courses.get(item.course_id)} divider={index > 0} />
          ))}
          {day.blocks.map((block, index) => (
            <BlockLine
              key={block.key}
              block={block}
              course={courses.get(block.course_id)}
              divider={index > 0 || day.deadlines.length > 0}
              onPress={() => openItem(block.item_id)}
            />
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  grow: { flex: 1 },
  struck: { textDecorationLine: 'line-through' },
});
