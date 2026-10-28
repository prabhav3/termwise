import { StyleSheet, View } from 'react-native';

import { ListRow, NBText } from '@/components/ui';
import type { ImpactInfo } from '@/engine';
import { describeDue, formatTimeOfDay, normalizeTime, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { ImpactStars, impactWords } from './impact';
import { KIND_LABEL } from './kinds';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Square date stamp ("OCT / 28"), "TBD" when there is no date. */
export function DateStamp({ date, done = false }: { date: ISODate | null; done?: boolean }) {
  const { colors, borders, spacing } = useTheme();
  return (
    <View
      accessible={false}
      style={[
        styles.stamp,
        {
          borderColor: colors.border,
          borderWidth: borders.hairline,
          backgroundColor: done ? colors.surfaceAlt : colors.surface,
          paddingVertical: spacing.xs,
        },
      ]}
    >
      {date ? (
        <>
          <NBText variant="label" color="muted" dense>
            {MONTHS[Number(date.slice(5, 7)) - 1]}
          </NBText>
          <NBText variant="h3" dense>
            {String(Number(date.slice(8, 10)))}
          </NBText>
        </>
      ) : (
        <NBText variant="label" dense>
          TBD
        </NBText>
      )}
    </View>
  );
}

const STATUS_WORD: Record<Item['status'], string | null> = { todo: null, in_progress: 'In progress', done: 'Done', missed: 'Missed' };

export function itemSubtitle(item: Pick<Item, 'kind' | 'due_date' | 'due_time' | 'status'>, today: ISODate): string {
  const parts: string[] = [KIND_LABEL[item.kind]];
  const status = STATUS_WORD[item.status];
  if (status) parts.push(status);
  if (item.due_date) {
    const due = describeDue(item.due_date, today);
    const time = item.due_time ? ` ${formatTimeOfDay(normalizeTime(item.due_time))}` : '';
    parts.push(due.overdue && item.status !== 'done' ? `${due.label} · late` : `${due.label}${time}`);
  } else {
    parts.push('No date yet');
  }
  return parts.join(' · ');
}

export interface ItemRowProps {
  item: Item;
  today: ISODate;
  impact?: ImpactInfo | null;
  onPress: () => void;
  divider?: boolean;
  /** Prefix for the spoken label, e.g. the course code in mixed lists. */
  context?: string;
}

/** One item: date stamp, title, kind · status · due, impact stars. */
export function ItemRow({ item, today, impact, onPress, divider, context }: ItemRowProps) {
  const subtitle = itemSubtitle(item, today);
  const spoken = [context, item.title, subtitle, impact ? impactWords(impact) : null].filter(Boolean).join(', ');
  return (
    <ListRow
      title={item.title}
      subtitle={subtitle}
      left={<DateStamp date={item.due_date} done={item.status === 'done'} />}
      right={impact ? <ImpactStars impact={impact} /> : undefined}
      onPress={onPress}
      divider={divider}
      accessibilityLabel={spoken}
    />
  );
}

const styles = StyleSheet.create({
  stamp: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
});
