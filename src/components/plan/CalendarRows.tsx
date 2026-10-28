import { Pressable, StyleSheet, View } from 'react-native';

import { CourseTag, Icon, InkProvider, inkForFill, NBText, StressPill, stressLabel, Tag } from '@/components/ui';
import type { CalendarRow, CalendarWeek } from '@/data/plan-views';
import type { EngineCourse } from '@/engine';
import { formatShortDate, parseISODate, WEEKDAY_SHORT, weekdayISO } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

import { courseName, itemKindLabel, termEventLabel, termEventTone } from './labels';
import { Stripes } from './Stripes';

// ---- week header -----------------------------------------------------------------------------

export interface WeekHeaderProps {
  week: CalendarWeek;
  onPress: () => void;
}

/** Sticky section header: week dates, "This week", and the week's stress when known. */
export function WeekHeader({ week, onPress }: WeekHeaderProps) {
  const { colors, borders, spacing } = useTheme();
  const range = `${formatShortDate(week.weekStart)} – ${formatShortDate(week.weekEnd)}`;
  const stress = week.stress;
  const spoken = `${week.isCurrent ? 'This week' : 'Week'}, ${range}${stress ? `, stress ${stress.score}, ${stressLabel(stress.level).toLowerCase()}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the week"
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        styles.header,
        {
          gap: spacing.sm,
          paddingTop: spacing.lg,
          paddingBottom: spacing.sm,
          backgroundColor: pressed ? colors.surfaceAlt : colors.bg,
          borderBottomWidth: borders.hairline,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <NBText variant="h3" style={styles.grow} numberOfLines={1} dense>
        {range}
      </NBText>
      {week.isCurrent ? <Tag label="This week" color="yellow" /> : null}
      {stress ? <StressPill level={stress.level} score={stress.score} compact /> : null}
      <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} />
    </Pressable>
  );
}

// ---- rows ------------------------------------------------------------------------------------

export interface CalendarRowViewProps {
  row: CalendarRow;
  courses: Map<string, EngineCourse>;
  onOpenItem: (itemId: string) => void;
}

function rangeText(start: string, end: string): string {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** A band, an item row, or "nothing this week". */
export function CalendarRowView({ row, courses, onOpenItem }: CalendarRowViewProps) {
  const theme = useTheme();
  const { colors, borders, radius, spacing } = theme;
  const pad = { marginTop: spacing.sm };

  if (row.type === 'empty') {
    return (
      <NBText variant="small" color="muted" style={[pad, { paddingVertical: spacing.sm }]}>
        Nothing due this week.
      </NBText>
    );
  }

  if (row.type === 'band') {
    const { event } = row;
    const tone = termEventTone(event.kind);
    const label = termEventLabel(event.kind);
    const course = event.course_id ? courses.get(event.course_id) : undefined;
    const fill = tone === 'surfaceAlt' ? colors.surfaceAlt : colors[tone];
    const range = rangeText(event.date, event.end_date);
    return (
      <InkProvider value={inkForFill(tone === 'surfaceAlt' ? 'surface' : 'accent', colors)}>
        <View
          accessible
          accessibilityLabel={`${label}: ${event.title}, ${range}${row.continues ? ', continues from last week' : ''}${course ? `, ${courseName(course)}` : ''}`}
          style={[
            styles.band,
            pad,
            {
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: fill,
              borderColor: colors.border,
              borderWidth: borders.hairline,
              borderRadius: radius.none,
            },
          ]}
        >
          {event.kind === 'finals_period' ? <Stripes opacity={0.18} /> : null}
          <NBText variant="label" dense>
            {label}
          </NBText>
          <View style={styles.grow}>
            <NBText variant="smallBold" numberOfLines={2} dense>
              {event.title}
            </NBText>
            <NBText variant="tiny" color="muted" dense>
              {`${range}${row.continues ? ' · continued' : ''}${course ? ` · ${courseName(course)}` : ''}`}
            </NBText>
          </View>
        </View>
      </InkProvider>
    );
  }

  const { event, item, major, done, flags } = row;
  const course = event.course_id ? courses.get(event.course_id) : undefined;
  const weekday = WEEKDAY_SHORT[weekdayISO(event.date)];
  const day = parseISODate(event.date).day;
  const kind = itemKindLabel(event.kind);
  const spoken = [
    `${weekday} ${formatShortDate(event.date)}`,
    event.title,
    courseName(course),
    kind,
    major ? 'major' : null,
    done ? 'done' : null,
    ...flags.map((flag) => `Check: ${flag.message}`),
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the assignment"
      onPress={() => {
        haptic('selection');
        onOpenItem(event.id);
      }}
      style={({ pressed }) => [
        styles.item,
        pad,
        {
          gap: spacing.md,
          padding: spacing.sm,
          backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
          borderColor: colors.border,
          borderWidth: major ? borders.standard : borders.hairline,
          borderRadius: radius.control,
        },
        major ? theme.shadow('sm') : null,
      ]}
    >
      <View
        style={[
          styles.stamp,
          { borderColor: colors.border, borderWidth: borders.hairline, backgroundColor: colors.surfaceAlt },
        ]}
      >
        <NBText variant="label" dense>
          {weekday}
        </NBText>
        <NBText variant="h3" dense>
          {String(day)}
        </NBText>
      </View>
      <View style={[styles.grow, { gap: 2 }]}>
        <NBText
          variant="bodyBold"
          color={done ? 'muted' : undefined}
          style={done ? styles.struck : null}
          numberOfLines={2}
          dense
        >
          {event.title}
        </NBText>
        <View style={[styles.meta, { gap: spacing.xs }]}>
          {course ? <CourseTag course={course} /> : null}
          <NBText variant="tiny" color="muted" dense>
            {`${kind}${done ? ' · Done' : ''}`}
          </NBText>
          {major && !done ? <Tag label="Major" color="pink" /> : null}
        </View>
        {flags.map((flag) => (
          <View key={`${flag.kind}:${flag.message}`} style={[styles.meta, { gap: spacing.xs }]}>
            <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={12} color={colors.ink} />
            <NBText variant="tiny" dense>
              {flag.label}
            </NBText>
          </View>
        ))}
      </View>
      {item ? <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  band: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  stamp: { width: 48, paddingVertical: 4, alignItems: 'center', borderRadius: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
  struck: { textDecorationLine: 'line-through' },
});
