import { StyleSheet, View } from 'react-native';

import { Card, CourseTag, Icon, NBText } from '@/components/ui';
import type { EngineCourse, RedZone } from '@/engine';
import { formatDayDate, relativeDayLabel, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';

import { itemKindLabel, zoneTitle } from './labels';
import { Stripes } from './Stripes';

export interface RedZoneCardProps {
  zone: RedZone;
  courses: Map<string, EngineCourse>;
  today: ISODate;
  /** Opens the week; the whole card becomes one button. */
  onPress?: () => void;
  /** Today's banner: message and dates only, no item list. */
  compact?: boolean;
}

export function zoneDates(zone: Pick<RedZone, 'start' | 'end'>): string {
  return zone.start === zone.end ? formatDayDate(zone.start) : `${formatDayDate(zone.start)} – ${formatDayDate(zone.end)}`;
}

/** When the zone starts, relative to today: "Starts in 3 days", "Starts tomorrow", "Happening now". */
export function zoneWhen(zone: Pick<RedZone, 'start' | 'end'>, today: ISODate): string {
  if (zone.start <= today && zone.end >= today) return 'Happening now';
  const relative = relativeDayLabel(zone.start, today);
  return relative === 'Today' || relative === 'Tomorrow' ? `Starts ${relative.toLowerCase()}` : `Starts ${relative}`;
}

/** A deadline cluster: red zones are red + striped + ⚠, crunches orange — the title always says which. */
export function RedZoneCard({ zone, courses, today, onPress, compact = false }: RedZoneCardProps) {
  const { radius, borders, spacing } = useTheme();
  const red = zone.severity === 'red';
  const title = zoneTitle(zone);
  const when = zoneWhen(zone, today);
  const dates = zoneDates(zone);
  const spoken = `${title}. ${when}, ${dates}. ${zone.message}.`;

  return (
    <Card
      color={red ? 'red' : 'orange'}
      onPress={onPress}
      accessibilityLabel={spoken}
      accessibilityHint={onPress ? 'Opens that week' : undefined}
      style={{ gap: spacing.sm }}
    >
      {red ? <Stripes radius={radius.card - borders.standard} /> : null}
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={18} />
        <NBText variant="label" style={styles.grow} dense>
          {`${title} · ${when}`}
        </NBText>
        {onPress ? <Icon name="chevron.right" fallback="›" size={14} /> : null}
      </View>
      <NBText variant={compact ? 'bodyBold' : 'h3'}>{zone.message}</NBText>
      <NBText variant="smallBold">{dates}</NBText>
      {compact ? null : (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          {zone.items.map((item) => {
            const course = courses.get(item.course_id);
            return (
              <View key={item.id} style={[styles.row, { gap: spacing.sm }]}>
                {course ? <CourseTag course={course} /> : null}
                <NBText variant="small" style={styles.grow} numberOfLines={2} dense>
                  {`${item.title} · ${itemKindLabel(item.kind)} · ${formatDayDate(item.due_date)}`}
                </NBText>
              </View>
            );
          })}
        </View>
      )}
      {compact && zone.courseIds.length > 0 ? (
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {zone.courseIds.map((id) => {
            const course = courses.get(id);
            return course ? <CourseTag key={id} course={course} /> : null;
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
});
