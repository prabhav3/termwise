import { StyleSheet, View } from 'react-native';

import { KindTag } from '@/components/items/kinds';
import { Card, CourseTag, NBText } from '@/components/ui';
import { describeDue, formatShortDate, formatTimeOfDay, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { SharedSnapshot } from '@/types/db';

import { courseByline, type SharedItem, type SnapshotSummary } from './model';

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Course identity: tag, title, who teaches it, and when it runs. */
export function SharedCourseCard({ course, importCount }: { course: SharedSnapshot['course']; importCount: number }) {
  const { spacing } = useTheme();
  const byline = courseByline(course);
  const runs =
    course.start_date && course.end_date
      ? `${formatShortDate(course.start_date)} – ${formatShortDate(course.end_date)}`
      : course.start_date
        ? `Starts ${formatShortDate(course.start_date)}`
        : null;
  const tagCourse = { code: course.code, title: course.title, color: course.color };

  return (
    <Card style={{ gap: spacing.sm }}>
      <CourseTag course={tagCourse} style={styles.start} />
      <NBText variant="h2">{course.title}</NBText>
      {byline ? (
        <NBText variant="small" color="muted">
          {byline}
        </NBText>
      ) : null}
      {runs ? <NBText variant="smallBold">{runs}</NBText> : null}
      {importCount > 0 ? (
        <NBText variant="small" color="muted">
          {`${plural(importCount, 'classmate')} already imported this.`}
        </NBText>
      ) : null}
    </Card>
  );
}

/** What comes with the import, as big countable tiles. */
export function ShareCounts({ summary }: { summary: SnapshotSummary }) {
  const { spacing } = useTheme();
  if (summary.total === 0) {
    return (
      <Card color="surfaceAlt" shadow="none">
        <NBText variant="body">
          No deadlines in this share yet. You’ll get the course details; add deadlines later or ask for a fresh link.
        </NBText>
      </Card>
    );
  }
  const extras = [
    summary.textbooks > 0 ? plural(summary.textbooks, 'textbook') : null,
    summary.termEvents > 0 ? plural(summary.termEvents, 'break or exam period', 'breaks and exam periods') : null,
  ].filter((part): part is string => part !== null);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.grid, { gap: spacing.md }]}>
        {summary.counts.map((count) => {
          const [number, ...words] = count.label.split(' ');
          return (
            <Card key={count.key} shadow="sm" style={styles.tile}>
              <View accessible accessibilityLabel={count.label} style={{ gap: spacing.xs }}>
                <NBText variant="number">{number}</NBText>
                <NBText variant="smallBold" dense>
                  {words.join(' ')}
                </NBText>
              </View>
            </Card>
          );
        })}
      </View>
      {extras.length > 0 ? (
        <NBText variant="small" color="muted">
          {`Also: ${extras.join(' · ')}.`}
        </NBText>
      ) : null}
    </View>
  );
}

function NextRow({ item, today, divider }: { item: SharedItem; today: ISODate; divider: boolean }) {
  const { colors, spacing, borders } = useTheme();
  const due = item.due_date ? describeDue(item.due_date, today) : null;
  const when = due ? `${due.label}${item.due_time ? ` · ${formatTimeOfDay(item.due_time)}` : ''}` : 'No date';
  return (
    <View
      accessible
      accessibilityLabel={`${item.title}, ${item.kind}, ${when}`}
      style={[
        styles.row,
        { gap: spacing.md, paddingVertical: spacing.md },
        divider ? { borderTopWidth: borders.hairline, borderTopColor: colors.border } : null,
      ]}
    >
      <View style={[styles.flex, { gap: spacing.xs }]}>
        <NBText variant="bodyBold" numberOfLines={2}>
          {item.title}
        </NBText>
        <NBText variant="small" color="muted">
          {when}
        </NBText>
      </View>
      <KindTag kind={item.kind} />
    </View>
  );
}

/** The next few deadlines, so a classmate can check it is the right section before importing. */
export function NextItems({ summary, today }: { summary: SnapshotSummary; today: ISODate }) {
  const { spacing } = useTheme();
  if (summary.next.length === 0) return null;
  return (
    <Card style={{ gap: spacing.xs }}>
      <NBText variant="label" color="muted">
        {summary.nextAreUpcoming ? 'Coming up' : 'First deadlines'}
      </NBText>
      {summary.next.map((item, index) => (
        <NextRow key={`${item.title}-${item.due_date ?? 'none'}-${index}`} item={item} today={today} divider={index > 0} />
      ))}
      {summary.dated > summary.next.length ? (
        <NBText variant="small" color="muted" style={{ paddingTop: spacing.sm }}>
          {`+ ${summary.dated - summary.next.length} more dated items`}
        </NBText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { flexGrow: 1, flexBasis: '40%', minWidth: 120 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
