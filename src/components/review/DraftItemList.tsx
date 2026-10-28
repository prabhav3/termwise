import { Pressable, StyleSheet, View } from 'react-native';

import { KindTag } from '@/components/items/kinds';
import { Badge, Card, Icon, NBText } from '@/components/ui';
import { formatDayDate, formatTimeOfDay } from '@/lib/dates';
import { formatChapterList } from '@/lib/import-extraction';
import { useTheme } from '@/theme';

import { groupByWeek, LOW_CONFIDENCE, type DraftItem } from './draft';

function detailLine(item: DraftItem): string {
  const parts: string[] = [];
  if (item.due_date) parts.push(item.due_time ? `${formatDayDate(item.due_date)}, ${formatTimeOfDay(item.due_time)}` : formatDayDate(item.due_date));
  else parts.push(item.date_text ? `“${item.date_text}”` : 'No date');
  if (item.weight_percent !== null) parts.push(`${Math.round(item.weight_percent * 10) / 10}%`);
  if (item.points_possible !== null) parts.push(`${item.points_possible} pts`);
  if (item.reading) {
    const r = item.reading;
    if (r.chapters.length > 0) parts.push(`Ch. ${formatChapterList(r.chapters)}`);
    else if (r.page_ranges.length > 0) parts.push(`pp. ${r.page_ranges.map((p) => `${p.start}–${p.end}`).join(', ')}`);
    else if (r.explicit_pages) parts.push(`${r.explicit_pages} pages`);
  }
  return parts.join(' · ');
}

function DraftItemRow({ item, onPress, divider }: { item: DraftItem; onPress: () => void; divider: boolean }) {
  const { colors, borders, spacing } = useTheme();
  const low = item.confidence < LOW_CONFIDENCE;
  const detail = detailLine(item);
  const spoken = [item.title || 'Untitled item', item.kind, detail, item.is_major ? 'major' : null, low ? 'low confidence, please check' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the item to edit"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderTopWidth: divider ? borders.hairline : 0,
          borderTopColor: colors.border,
          backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={[styles.flex, { gap: spacing.xs }]}>
        <View style={[styles.tags, { gap: spacing.xs }]}>
          <KindTag kind={item.kind} />
          {item.is_major ? <Badge label="Major" tone="ink" /> : null}
          {low ? <Badge label="Check" tone="orange" /> : null}
        </View>
        <NBText variant="bodyBold" dense numberOfLines={2}>
          {item.title.trim() || 'Untitled item'}
        </NBText>
        <NBText variant="small" color="muted" dense numberOfLines={2}>
          {detail}
        </NBText>
        {low && item.source_quote ? (
          <NBText variant="small" dense numberOfLines={2}>{`“${item.source_quote}”`}</NBText>
        ) : null}
      </View>
      <Icon name="chevron.right" fallback="›" size={14} color={colors.inkMuted} />
    </Pressable>
  );
}

export function DraftItemList({
  items,
  courseStart,
  onOpen,
}: {
  items: DraftItem[];
  courseStart: string | null;
  onOpen: (key: string) => void;
}) {
  const { spacing } = useTheme();
  const groups = groupByWeek(items, courseStart);
  if (items.length === 0) {
    return (
      <NBText variant="body" color="muted">
        Nothing found yet. Add the deadlines you know about.
      </NBText>
    );
  }
  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map((group) => (
        <View key={group.key} style={{ gap: spacing.sm }}>
          <NBText variant="label" color={group.key === 'undated' ? 'ink' : 'muted'} accessibilityRole="header">
            {group.key === 'undated' ? `⚠ ${group.title}` : group.title}
          </NBText>
          <Card padded={false} shadow="sm">
            {group.items.map((item, index) => (
              <DraftItemRow key={item.key} item={item} divider={index > 0} onPress={() => onOpen(item.key)} />
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  flex: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
