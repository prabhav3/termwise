// A grading category (or the self-weighted / uncounted buckets) with its items and scores.
import { StyleSheet, View } from 'react-native';

import { Button, Card, NBText } from '@/components/ui';
import type { ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { formatGrade, formatWeight, type GradeGroup } from './model';
import { ScoreRow } from './ScoreRow';

export interface GradeGroupCardProps {
  title: string;
  /** "25% of grade · 3 of 5 graded · lowest 1 dropped" */
  meta: string | null;
  percent: number | null;
  /** Explains why this bucket is special (uncounted items). */
  note?: string | null;
  rows: { item: Item; weight: number | null; dropped: boolean }[];
  missing: number;
  today: ISODate;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onSave: (item: Item, score: number | null, pointsPossible: number | null) => void;
  /** Adds an item to this category (shown when items are expected but not listed). */
  onAddMissing?: () => void;
}

export function groupMeta(group: GradeGroup<Item>): string {
  const parts: string[] = [];
  if (group.weight !== null) parts.push(`${formatWeight(group.weight)} of grade`);
  const total = group.items.length + group.missing;
  if (total > 0) parts.push(`${group.gradedCount} of ${total} graded`);
  if (group.dropLowest > 0) parts.push(`lowest ${group.dropLowest} dropped`);
  return parts.join(' · ');
}

export function GradeGroupCard({
  title,
  meta,
  percent,
  note,
  rows,
  missing,
  today,
  editingId,
  onEdit,
  onSave,
  onAddMissing,
}: GradeGroupCardProps) {
  const { spacing } = useTheme();

  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${title}${meta ? `, ${meta}` : ''}, ${percent === null ? 'no scores yet' : `${formatGrade(percent).replace('%', ' percent')} so far`}`}
          style={[styles.header, { gap: spacing.md }]}
        >
          <View style={[styles.title, { gap: 2 }]}>
            <NBText variant="h3" numberOfLines={2}>
              {title}
            </NBText>
            {meta ? (
              <NBText variant="small" color="muted" dense>
                {meta}
              </NBText>
            ) : null}
          </View>
          <NBText variant="h2" dense numberOfLines={1}>
            {formatGrade(percent)}
          </NBText>
        </View>
        {note ? (
          <NBText variant="small" color="muted">
            {note}
          </NBText>
        ) : null}
        {rows.length > 0 ? (
          <View>
            {rows.map((row) => (
              <ScoreRow
                key={row.item.id}
                item={row.item}
                today={today}
                weight={row.weight}
                dropped={row.dropped}
                divider
                expanded={editingId === row.item.id}
                onToggle={() => onEdit(editingId === row.item.id ? null : row.item.id)}
                onSave={onSave}
              />
            ))}
          </View>
        ) : null}
        {missing > 0 || rows.length === 0 ? (
          <View style={[styles.missing, { gap: spacing.sm }]}>
            <NBText variant="small" color="muted" style={styles.title}>
              {rows.length === 0
                ? 'Nothing listed in this category yet.'
                : `${missing} more expected — not listed yet.`}
            </NBText>
            {onAddMissing ? (
              <Button label="Add one" size="sm" variant="ghost" accessibilityLabel={`Add an item to ${title}`} onPress={onAddMissing} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { flex: 1 },
  missing: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
