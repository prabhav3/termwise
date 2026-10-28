// Single-choice list of ungraded items for "What do I need?".
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, NBText, Sheet } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { describeDue, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { formatWeight } from './model';

export interface ItemPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  items: { item: Item; weight: number | null }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  today: ISODate;
}

export function ItemPickerSheet({ visible, onClose, items, selectedId, onSelect, today }: ItemPickerSheetProps) {
  const { colors, borders, spacing } = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose} title="Which assignment?">
      <ScrollView style={styles.list} accessibilityRole="radiogroup">
        {items.map(({ item, weight }, index) => {
          const selected = item.id === selectedId;
          const details = [
            item.due_date ? describeDue(item.due_date, today).label : 'No date',
            weight !== null && weight > 0 ? `${formatWeight(weight)} of grade` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              key={item.id}
              accessibilityRole="radio"
              accessibilityLabel={`${item.title}, ${details}`}
              accessibilityState={{ selected }}
              onPress={() => {
                haptic('selection');
                onSelect(item.id);
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                  borderTopWidth: index === 0 ? 0 : borders.hairline,
                  borderTopColor: colors.border,
                },
                pressed || selected ? { backgroundColor: colors.surfaceAlt } : null,
              ]}
            >
              <View style={styles.check}>
                {selected ? <Icon name="checkmark" fallback="✓" size={18} weight="heavy" /> : null}
              </View>
              <View style={styles.text}>
                <NBText variant="bodyBold" numberOfLines={2} dense>
                  {item.title}
                </NBText>
                <NBText variant="small" color="muted" dense>
                  {details}
                </NBText>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  check: { width: 24, alignItems: 'center' },
  text: { flex: 1, gap: 2 },
});
