import { StyleSheet, View } from 'react-native';

import { courseName } from '@/components/plan/labels';
import { Button, Card, Icon, ListRow, NBText, Tag } from '@/components/ui';
import type { CarryOver } from '@/data/plan-views';
import type { AnnotatedItem, EngineCourse, OverflowWarning } from '@/engine';
import { formatDayDate, formatMinutes, WEEKDAY_SHORT, weekdayISO } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { CalendarProvider, Item } from '@/types/db';

// ---- carried-over work ----------------------------------------------------------------------------

export interface CarryOverNoticeProps {
  carry: CarryOver;
  onDismiss: () => void;
}

function dayRange(from: string, to: string): string {
  return from === to ? WEEKDAY_SHORT[weekdayISO(from)] : `${WEEKDAY_SHORT[weekdayISO(from)]}–${WEEKDAY_SHORT[weekdayISO(to)]}`;
}

/** Missed work from the last few days, already folded back into the plan. Reassuring, dismissible. */
export function CarryOverNotice({ carry, onDismiss }: CarryOverNoticeProps) {
  const { spacing } = useTheme();
  const count = carry.blocks.length;
  return (
    <Card color="surfaceAlt" shadow="sm" style={{ gap: spacing.sm }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Icon name="arrow.uturn.forward" fallback="↷" size={18} />
        <NBText variant="bodyBold" style={styles.grow}>
          {`Carried over: ${formatMinutes(carry.minutes)} from ${dayRange(carry.from, carry.to)}`}
        </NBText>
      </View>
      <NBText variant="small">
        {`${count} ${count === 1 ? 'block' : 'blocks'} didn't get checked off. That work is already spread across your next study days — nothing to fix.`}
      </NBText>
      <Button label="Got it" variant="ghost" size="sm" onPress={onDismiss} accessibilityHint="Hides this note for today" />
    </Card>
  );
}

// ---- overflow -------------------------------------------------------------------------------------------

export interface OverflowNoticeProps {
  warnings: readonly OverflowWarning[];
  items: Map<string, AnnotatedItem>;
  courses: Map<string, EngineCourse>;
  onOpenItem: (itemId: string) => void;
  onSeeAll: () => void;
  /** How many to show before "and N more". */
  limit?: number;
}

/** Work that doesn't fit before its deadline, each with the engine's plain suggestion. */
export function OverflowNotice({ warnings, items, courses, onOpenItem, onSeeAll, limit = 2 }: OverflowNoticeProps) {
  const { spacing } = useTheme();
  if (warnings.length === 0) return null;
  const shown = warnings.slice(0, limit);
  const more = warnings.length - shown.length;
  return (
    <View style={{ gap: spacing.md }}>
      {shown.map((warning) => {
        const item = items.get(warning.item_id);
        const course = item ? courses.get(item.course_id) : undefined;
        return (
          <Card
            key={warning.item_id}
            shadow="sm"
            onPress={() => onOpenItem(warning.item_id)}
            accessibilityLabel={`Not enough time: ${warning.message}. Suggestion: ${warning.suggestion}`}
            accessibilityHint="Opens the assignment"
            style={{ gap: spacing.sm }}
          >
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Tag label="⚠ Not enough time" color="orange" />
              {course ? (
                <NBText variant="tiny" color="muted" dense>
                  {courseName(course)}
                </NBText>
              ) : null}
            </View>
            <NBText variant="bodyBold">{warning.message}</NBText>
            <View style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
              <Icon name="lightbulb" fallback="→" size={16} />
              <NBText variant="small" style={styles.grow}>
                {warning.suggestion}
              </NBText>
            </View>
          </Card>
        );
      })}
      {more > 0 ? (
        <Button label={`${more} more on your plan`} variant="ghost" size="sm" onPress={onSeeAll} />
      ) : null}
    </View>
  );
}

// ---- external calendar edits -----------------------------------------------------------------------

const PROVIDER_NAME: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook',
  apple: 'Apple Calendar',
};

function changeText(item: Item): string {
  const change = item.external_change;
  if (!change) return '';
  const where = PROVIDER_NAME[change.provider];
  if (change.deleted) return `Deleted in ${where}`;
  if (change.new_due_date) return `${where} moved it to ${formatDayDate(change.new_due_date)}`;
  return `Changed in ${where}`;
}

export interface ExternalChangesCardProps {
  items: readonly Item[];
  courses: Map<string, EngineCourse>;
  onOpenItem: (itemId: string) => void;
}

/** Date edits made in Google/Outlook that are waiting for the student to accept or keep Termwise's date. */
export function ExternalChangesCard({ items, courses, onOpenItem }: ExternalChangesCardProps) {
  const { spacing } = useTheme();
  if (items.length === 0) return null;
  return (
    <Card shadow="sm" style={{ gap: spacing.xs }}>
      <Tag label="Calendar sync" color="blue" />
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Icon name="calendar.badge.exclamationmark" fallback="▦" size={20} />
        <NBText variant="bodyBold" style={styles.grow}>
          {items.length === 1 ? 'A calendar change to review' : `${items.length} calendar changes to review`}
        </NBText>
      </View>
      {items.map((item, index) => (
        <ListRow
          key={item.id}
          title={item.title}
          subtitle={`${changeText(item)} · ${courseName(courses.get(item.course_id))}`}
          divider={index > 0}
          onPress={() => onOpenItem(item.id)}
          accessibilityHint="Opens it so you can accept or keep the original date"
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
});
