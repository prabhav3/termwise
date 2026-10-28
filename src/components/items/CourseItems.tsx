// A course's items: what is coming up first (calm), everything else one tap away.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { routes } from '@/components/courses/nav';
import { Button, Card, NBText } from '@/components/ui';
import type { ImpactInfo } from '@/engine';
import type { ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import { ItemRow } from './ItemRow';

const SOON_COUNT = 5;

const byDue = (a: Item, b: Item) =>
  (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99') || (a.due_time ?? '').localeCompare(b.due_time ?? '') || a.title.localeCompare(b.title);

export interface CourseItemsProps {
  items: readonly Item[];
  today: ISODate;
  impacts: ReadonlyMap<string, ImpactInfo> | null;
  courseId: string;
}

function ItemGroup({ title, items, today, impacts }: { title: string; items: readonly Item[]; today: ISODate; impacts: CourseItemsProps['impacts'] }) {
  const { spacing } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <NBText variant="label" color="muted" accessibilityRole="header">
        {title}
      </NBText>
      <Card padded={false} shadow="sm">
        {items.map((item, index) => (
          <ItemRow
            key={item.id}
            item={item}
            today={today}
            impact={impacts?.get(item.id) ?? null}
            divider={index > 0}
            onPress={() => router.push(routes.item(item.id))}
          />
        ))}
      </Card>
    </View>
  );
}

export function CourseItems({ items, today, impacts, courseId }: CourseItemsProps) {
  const { spacing } = useTheme();
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => {
    const open = items.filter((item) => item.status !== 'done' && item.status !== 'missed');
    return {
      late: open.filter((item) => item.due_date !== null && item.due_date < today).sort(byDue),
      upcoming: open.filter((item) => item.due_date === null || item.due_date >= today).sort(byDue),
      finished: items.filter((item) => item.status === 'done' || item.status === 'missed').sort((a, b) => byDue(b, a)),
    };
  }, [items, today]);

  if (items.length === 0) {
    return (
      <View style={{ gap: spacing.md }}>
        <NBText variant="body" color="muted">
          No deadlines yet. Add them by hand or upload the syllabus.
        </NBText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button label="Add an item" size="sm" icon={{ name: 'plus', fallback: '+' }} onPress={() => router.push(routes.itemNew(courseId))} />
          <Button label="Upload syllabus" size="sm" variant="secondary" onPress={() => router.push(routes.upload({ courseId }))} />
        </View>
      </View>
    );
  }

  const soon = showAll ? groups.upcoming : groups.upcoming.slice(0, SOON_COUNT);
  const hidden = groups.upcoming.length - soon.length + (showAll ? 0 : groups.finished.length);

  return (
    <View style={{ gap: spacing.lg }}>
      <ItemGroup title={`⚠ Past due (${groups.late.length})`} items={groups.late} today={today} impacts={impacts} />
      {soon.length > 0 ? (
        <ItemGroup title="Coming up" items={soon} today={today} impacts={impacts} />
      ) : groups.late.length === 0 ? (
        <NBText variant="body" color="muted">
          Nothing left to do here. Nice.
        </NBText>
      ) : null}
      {showAll ? <ItemGroup title={`Done or missed (${groups.finished.length})`} items={groups.finished} today={today} impacts={impacts} /> : null}
      {hidden > 0 || showAll ? (
        <Button
          label={showAll ? 'Show less' : `Show everything (${hidden} more)`}
          variant="ghost"
          onPress={() => setShowAll((value) => !value)}
        />
      ) : null}
    </View>
  );
}
