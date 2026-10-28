// The study sessions the planner made for one item. Tapping an open session starts focus.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { routes } from '@/components/courses/nav';
import { Button, Card, Icon, ListRow, NBText, type SymbolName } from '@/components/ui';
import { describeDue, formatMinutes, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { BlockStatus, Item, PlanBlock } from '@/types/db';

const VISIBLE = 5;

const STATUS: Record<BlockStatus, { word: string; icon: SymbolName; fallback: string }> = {
  planned: { word: 'Planned', icon: 'circle', fallback: '○' },
  done: { word: 'Done', icon: 'checkmark.circle.fill', fallback: '✓' },
  missed: { word: 'Missed', icon: 'xmark.circle', fallback: '✕' },
  skipped: { word: 'Skipped', icon: 'arrow.uturn.right.circle', fallback: '↷' },
};

export interface ItemBlocksProps {
  item: Pick<Item, 'due_date' | 'status'>;
  blocks: readonly PlanBlock[];
  today: ISODate;
}

export function ItemBlocks({ item, blocks, today }: ItemBlocksProps) {
  const { spacing, colors } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const sorted = [...blocks].sort((a, b) => a.date.localeCompare(b.date) || a.sort_order - b.sort_order);
  const ahead = sorted.filter((block) => block.status === 'planned' && block.date >= today);
  const past = sorted.filter((block) => !(block.status === 'planned' && block.date >= today));
  const plannedMinutes = ahead.reduce((sum, block) => sum + block.minutes, 0);
  const doneMinutes = sorted.filter((block) => block.status === 'done').reduce((sum, block) => sum + block.minutes, 0);

  if (sorted.length === 0) {
    const message =
      item.status === 'done' || item.status === 'missed'
        ? 'Nothing left to plan for this one.'
        : item.due_date === null
          ? 'Add a due date and Termwise plans the work for you.'
          : 'No sessions yet — your plan updates in a moment.';
    return (
      <NBText variant="body" color="muted">
        {message}
      </NBText>
    );
  }

  const list = showAll ? [...ahead, ...past.slice().reverse()] : ahead.slice(0, VISIBLE);
  const hidden = showAll ? 0 : sorted.length - list.length;

  return (
    <View style={{ gap: spacing.md }}>
      <NBText variant="smallBold" color="muted">
        {[plannedMinutes > 0 ? `${formatMinutes(plannedMinutes)} planned` : null, doneMinutes > 0 ? `${formatMinutes(doneMinutes)} done` : null]
          .filter(Boolean)
          .join(' · ') || 'All sessions are behind you'}
      </NBText>
      {list.length > 0 ? (
        <Card padded={false} shadow="sm">
          {list.map((block, index) => {
            const status = STATUS[block.status];
            const when = describeDue(block.date, today).label;
            const pages = block.page_start !== null && block.page_end !== null ? ` · pp. ${block.page_start}–${block.page_end}` : '';
            const open = block.status === 'planned';
            return (
              <ListRow
                key={block.key}
                title={block.label}
                subtitle={`${when} · ${formatMinutes(block.minutes)}${pages}${open ? '' : ` · ${status.word}`}`}
                left={<Icon name={status.icon} fallback={status.fallback} size={22} color={open ? colors.ink : colors.inkMuted} />}
                onPress={open ? () => router.push(routes.focus(block.key)) : undefined}
                chevron={open}
                divider={index > 0}
                accessibilityLabel={`${block.label}, ${when}, ${formatMinutes(block.minutes)}, ${status.word}`}
                accessibilityHint={open ? 'Starts a focus session for this' : undefined}
              />
            );
          })}
        </Card>
      ) : null}
      {hidden > 0 || showAll ? (
        <Button label={showAll ? 'Show less' : `Show all ${sorted.length} sessions`} variant="ghost" onPress={() => setShowAll((value) => !value)} />
      ) : null}
    </View>
  );
}
