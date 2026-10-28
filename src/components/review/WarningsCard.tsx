import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, IconButton, NBText } from '@/components/ui';
import { useTheme } from '@/theme';

import type { DraftItem, DraftWarning } from './draft';

const KIND_TITLE: Record<DraftWarning['kind'], string> = {
  ambiguous_date: 'Unclear date',
  missing_weight: 'Missing weight',
  weights_dont_sum: 'Weights don’t add up',
  unresolved_reading: 'Reading needs pages',
  tbd_date: 'Date to be announced',
  conflict: 'Conflicting info',
  low_quality_scan: 'Hard-to-read scan',
  other: 'Check this',
};

export interface WarningsCardProps {
  warnings: DraftWarning[];
  items: DraftItem[];
  onOpenItem: (key: string) => void;
  onOpenGrading: () => void;
  onDismiss: (key: string) => void;
}

function relatedItem(warning: DraftWarning, items: readonly DraftItem[]): DraftItem | undefined {
  const title = warning.related_item_title?.trim().toLowerCase();
  if (!title) return undefined;
  return items.find((item) => item.title.trim().toLowerCase() === title) ?? items.find((item) => item.title.toLowerCase().includes(title));
}

/** Warnings first, each with the one action that fixes it. */
export function WarningsCard({ warnings, items, onOpenItem, onOpenGrading, onDismiss }: WarningsCardProps) {
  const { colors, borders, spacing } = useTheme();
  if (warnings.length === 0) return null;
  return (
    <Card color="orange" style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={22} />
        <NBText variant="h3" style={styles.flex}>
          {`Check ${warnings.length === 1 ? 'this' : `these ${warnings.length}`} first`}
        </NBText>
      </View>
      {warnings.map((warning, index) => {
        const item = relatedItem(warning, items);
        const fixGrading = warning.kind === 'weights_dont_sum' || (warning.kind === 'missing_weight' && !item);
        return (
          <View
            key={warning.key}
            style={[
              styles.warning,
              { gap: spacing.sm, paddingTop: index === 0 ? 0 : spacing.md, borderTopWidth: index === 0 ? 0 : borders.hairline, borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.row, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <NBText variant="label">{KIND_TITLE[warning.kind]}</NBText>
                <NBText variant="bodyMedium">{warning.message}</NBText>
              </View>
              <IconButton icon="xmark" fallback="✕" label={`Dismiss: ${warning.message}`} variant="ghost" onPress={() => onDismiss(warning.key)} />
            </View>
            {item ? (
              <Button label={`Fix “${item.title || 'item'}”`} size="sm" variant="secondary" onPress={() => onOpenItem(item.key)} />
            ) : fixGrading ? (
              <Button label="Fix the weights" size="sm" variant="secondary" onPress={onOpenGrading} />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  warning: {},
  flex: { flex: 1 },
});
