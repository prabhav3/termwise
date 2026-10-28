import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';

import { goBackOr, param, routes } from '@/components/courses/nav';
import { ExternalChangeBanner } from '@/components/items/ExternalChangeBanner';
import { ImpactStars, impactWords, useImpactMap } from '@/components/items/impact';
import { ItemBlocks } from '@/components/items/ItemBlocks';
import { ItemForm } from '@/components/items/ItemForm';
import { itemFormFrom, toItemPatch, validateItemForm, type ItemFormValues } from '@/components/items/item-form';
import { ItemScoreCard } from '@/components/items/ItemScoreCard';
import { KindTag } from '@/components/items/kinds';
import { localStamp } from '@/components/items/time';
import { Badge, Button, Card, EmptyState, ErrorBanner, Icon, LoadingBlock, NBText, Screen, SectionHeader, useToast } from '@/components/ui';
import {
  useBlocksForItem,
  useComponents,
  useCourse,
  useDeleteItem,
  useItem,
  useKeepTermwiseDate,
  useResolveExternalChange,
  useSetItemStatus,
  useTextbooks,
  useUpdateItem,
} from '@/data';
import { useAuth } from '@/lib/auth';
import { describeDue, formatLongDate, formatTimeOfDay, type ISODate } from '@/lib/dates';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { formatChapterList, formatPageRanges } from '@/lib/import-extraction';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';
import type { Item, ItemStatus, RowSource, Textbook } from '@/types/db';

const SOURCE_LABEL: Record<RowSource, string> = {
  ai: 'From your syllabus',
  manual: 'Added by you',
  shared: "From a classmate's timeline",
  canvas: 'From Canvas',
  lms: 'From your LMS',
};

const STATUS_BADGE: Record<ItemStatus, { label: string; tone: 'green' | 'red' | 'blue' } | null> = {
  todo: null,
  in_progress: { label: 'In progress', tone: 'blue' },
  done: { label: 'Done', tone: 'green' },
  missed: { label: 'Missed', tone: 'red' },
};

function readingLine(item: Item, textbooks: readonly Textbook[]): string | null {
  const reading = item.reading;
  if (!reading) return item.pages ? `${item.pages} pages` : null;
  const book = reading.textbook_id ? textbooks.find((t) => t.id === reading.textbook_id)?.title : null;
  const parts = [
    book,
    reading.chapters.length > 0 ? `Ch. ${formatChapterList(reading.chapters)}` : null,
    reading.page_ranges.length > 0 ? `pp. ${formatPageRanges(reading.page_ranges)}` : null,
    reading.explicit_pages ? `${reading.explicit_pages} pages` : null,
    reading.description,
  ];
  return parts.filter(Boolean).join(' · ') || null;
}

/** Canvas / LMS lock date: when submissions close, and whether that comes before the due date. */
function lockNotice(item: Item, timeZone: string | null | undefined, today: ISODate): { text: string; urgent: boolean } | null {
  if (item.status === 'done') return null;
  const lock = localStamp(item.lms_lock_at, timeZone);
  if (!lock) return null;
  const lms = item.canvas_assignment_id || item.source === 'canvas' ? 'Canvas' : 'Your LMS';
  if (lock.date < today) return { text: `${lms} locked this on ${lock.label}. Ask your instructor if you still need to hand it in.`, urgent: true };
  const due = item.due_date;
  const beforeDue = due !== null && (lock.date < due || (lock.date === due && item.due_time !== null && lock.time < item.due_time.slice(0, 5)));
  if (beforeDue) return { text: `${lms} locks this on ${lock.label} — before it's due. Submit by then.`, urgent: true };
  return { text: `${lms} stops taking submissions ${lock.label}.`, urgent: false };
}

export default function ItemScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = param(params.id);
  const { spacing, colors } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);

  const item = useItem(id);
  const row = item.data ?? null;
  const course = useCourse(row?.course_id);
  const components = useComponents(row?.course_id ?? null);
  const textbooks = useTextbooks(row?.course_id ?? null);
  const blocks = useBlocksForItem(id);
  const impacts = useImpactMap();
  const setStatus = useSetItemStatus();
  const update = useUpdateItem();
  const remove = useDeleteItem();
  const accept = useResolveExternalChange();
  const keep = useKeepTermwiseDate();

  const [pendingStatus, setPendingStatus] = useState<ItemStatus | null>(null);
  const [editing, setEditing] = useState<ItemFormValues | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([item.refetch(), blocks.refetch(), course.refetch()]);
    setRefreshing(false);
  };

  const header = (title: string, right?: () => ReactNode) => <Stack.Screen options={{ title, headerRight: right }} />;

  if (item.isPending) {
    return (
      <Screen edges={['bottom']}>
        {header('')}
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading the item" height={160} />
          <LoadingBlock label="Loading the item" lines={3} />
        </View>
      </Screen>
    );
  }
  if (item.error) {
    return (
      <Screen edges={['bottom']}>
        {header('')}
        <ErrorBanner title="Couldn't load this item" message={errorMessage(item.error)} onRetry={() => void item.refetch()} />
      </Screen>
    );
  }
  if (!row) {
    return (
      <Screen edges={['bottom']}>
        {header('')}
        <EmptyState
          tone="yellow"
          title="Item not found"
          message="It may have been deleted, or it belongs to a course you removed."
          actionLabel="Go to Courses"
          onAction={() => router.replace(routes.coursesTab())}
        />
      </Screen>
    );
  }

  const courseRow = course.data ?? null;
  const courseComponents = components.data ?? [];
  const books = textbooks.data ?? [];
  const status = pendingStatus ?? row.status;
  const open = status === 'todo' || status === 'in_progress';
  const impact = impacts?.get(row.id) ?? null;
  const due = row.due_date ? describeDue(row.due_date, today) : null;
  const late = open && due !== null && due.overdue;
  const component = courseComponents.find((c) => c.id === row.component_id);
  const lock = lockNotice(row, profile?.timezone, today);
  const reading = readingLine(row, books);
  const badge = STATUS_BADGE[status];

  // ---- actions --------------------------------------------------------------------------------

  const changeStatus = (next: ItemStatus) => {
    setPendingStatus(next);
    haptic(next === 'done' ? 'success' : 'light');
    setStatus.mutate(
      { id: row.id, status: next },
      {
        onSuccess: () =>
          toast.show(
            next === 'done'
              ? { tone: 'success', title: 'Done', message: `${row.title} is checked off. Your plan is updating.` }
              : next === 'missed'
                ? { tone: 'info', title: 'Marked as missed', message: 'It is out of your plan. Reopen it if you can still hand it in.' }
                : { tone: 'info', title: 'Reopened', message: 'It is back in your plan.' },
          ),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't update it", message: errorMessage(error) }),
        onSettled: () => setPendingStatus(null),
      },
    );
  };

  const confirmMissed = () =>
    Alert.alert('Mark as missed?', 'Termwise stops planning work for it. You can reopen it later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark missed', onPress: () => changeStatus('missed') },
    ]);

  const confirmDelete = () =>
    Alert.alert(`Delete “${row.title}”?`, 'Its study sessions and score are removed too. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(row.id, {
            onSuccess: () => {
              toast.show({ tone: 'info', title: 'Deleted', message: `${row.title} is gone from your plan.` });
              goBackOr(routes.course(row.course_id));
            },
            onError: (error) => toast.show({ tone: 'danger', title: "Couldn't delete it", message: errorMessage(error) }),
          }),
      },
    ]);

  const acceptChange = () =>
    accept.mutate(
      { item: row, accept: true },
      {
        onSuccess: () => toast.show({ tone: 'success', title: 'Updated', message: 'Your plan now follows your calendar.' }),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't update it", message: errorMessage(error) }),
      },
    );

  const keepMine = () =>
    keep.mutate(row.id, {
      onSuccess: () => toast.show({ tone: 'info', title: 'Kept your Termwise date', message: 'Your calendar gets it back on the next sync.' }),
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't keep it", message: errorMessage(error) }),
    });

  // ---- edit mode -------------------------------------------------------------------------------

  if (editing) {
    const errors = validateItemForm(editing);
    const save = () => {
      setSubmitted(true);
      if (errors.title || errors.assignedDate) return;
      const changes = toItemPatch(editing, row);
      if (Object.keys(changes).length === 0) {
        setEditing(null);
        return;
      }
      update.mutate(
        { id: row.id, changes },
        {
          onSuccess: () => {
            setEditing(null);
            setSubmitted(false);
            toast.show({ tone: 'success', title: 'Saved', message: 'Your plan is updating.' });
          },
        },
      );
    };
    return (
      <Screen
        edges={['bottom']}
        footer={<Button label="Save changes" size="lg" fullWidth loading={update.isPending} onPress={save} />}
      >
        {header('Edit item', () => (
          <Button
            label="Cancel"
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onPress={() => {
              setEditing(null);
              setSubmitted(false);
              update.reset();
            }}
          />
        ))}
        <View style={{ gap: spacing.lg }}>
          {update.error ? <ErrorBanner title="Couldn't save" message={errorMessage(update.error)} onRetry={save} /> : null}
          <ItemForm
            values={editing}
            onChange={setEditing}
            components={courseComponents}
            textbooks={books}
            errors={submitted ? errors : { title: null, assignedDate: errors.assignedDate }}
          />
        </View>
      </Screen>
    );
  }

  // ---- detail ----------------------------------------------------------------------------------

  return (
    <Screen
      edges={['bottom']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}
    >
      {header(courseRow?.code ?? '', () => (
        <Button label="Edit" size="sm" variant="secondary" onPress={() => setEditing(itemFormFrom(row))} accessibilityLabel={`Edit ${row.title}`} />
      ))}

      <View style={{ gap: spacing.lg }}>
        {row.external_change ? (
          <ExternalChangeBanner
            change={row.external_change}
            onAccept={acceptChange}
            onKeep={keepMine}
            busy={accept.isPending ? 'accept' : keep.isPending ? 'keep' : null}
          />
        ) : null}

        {lock ? (
          <Card color={lock.urgent ? 'orange' : 'surfaceAlt'} shadow={lock.urgent ? 'sm' : 'none'}>
            <View style={[styles.row, { gap: spacing.sm }]} accessible accessibilityRole={lock.urgent ? 'alert' : 'text'}>
              <Icon name="lock.fill" fallback="⚿" size={20} />
              <NBText variant="bodyMedium" style={styles.flex}>
                {lock.urgent ? `⚠ ${lock.text}` : lock.text}
              </NBText>
            </View>
          </Card>
        ) : null}

        <Card color={courseRow?.color} shadow="lg" style={{ gap: spacing.sm }}>
          <View style={[styles.tags, { gap: spacing.xs }]}>
            <KindTag kind={row.kind} />
            {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
            {late ? <Badge label="Late" tone="red" accessibilityLabel="Past due" /> : null}
            {row.is_major ? <Badge label="Major" tone="ink" /> : null}
          </View>
          <NBText variant="h1" accessibilityRole="header">
            {row.title}
          </NBText>
          {courseRow ? (
            <NBText variant="smallBold" color="muted">
              {courseRow.code ? `${courseRow.code} · ${courseRow.title}` : courseRow.title}
            </NBText>
          ) : null}
          <NBText variant="h3" style={{ marginTop: spacing.xs }}>
            {row.due_date
              ? `${formatLongDate(row.due_date)}${row.due_time ? ` · ${formatTimeOfDay(row.due_time)}` : ''}`
              : 'No due date yet'}
          </NBText>
          {due ? (
            <NBText variant="small" color="muted">
              {status === 'done' ? 'Finished' : due.overdue ? `Was due ${due.relative.toLowerCase()}` : `Due ${due.relative.toLowerCase()}`}
            </NBText>
          ) : (
            <Button label="Add a due date" size="sm" variant="secondary" onPress={() => setEditing(itemFormFrom(row))} style={styles.start} />
          )}
        </Card>

        <View style={[styles.actions, { gap: spacing.sm }]}>
          {open ? (
            <>
              <Button
                label="Mark done"
                icon={{ name: 'checkmark', fallback: '✓' }}
                onPress={() => changeStatus('done')}
                disabled={setStatus.isPending}
                style={styles.grow}
              />
              <Button label="I missed it" variant="secondary" onPress={confirmMissed} disabled={setStatus.isPending} style={styles.grow} />
            </>
          ) : (
            <Button
              label="Reopen"
              variant="secondary"
              icon={{ name: 'arrow.uturn.backward', fallback: '↺' }}
              onPress={() => changeStatus('todo')}
              disabled={setStatus.isPending}
              style={styles.grow}
            />
          )}
        </View>
      </View>

      <SectionHeader title="Why it matters" />
      <Card shadow="sm" style={{ gap: spacing.sm }}>
        {impact ? (
          <>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <ImpactStars impact={impact} size={18} />
              <NBText variant="bodyBold" style={styles.flex}>
                {impactWords(impact)}
              </NBText>
              {impact.weight !== null ? <NBText variant="h3">{`${Math.round(impact.weight * 10) / 10}%`}</NBText> : null}
            </View>
            {impact.reasons.length > 0 ? (
              impact.reasons.map((reason) => (
                <NBText key={reason} variant="small">
                  {`• ${reason}`}
                </NBText>
              ))
            ) : (
              <NBText variant="small" color="muted">
                A small part of your grade — keep it moving, don&apos;t sweat it.
              </NBText>
            )}
            {component ? (
              <NBText variant="small" color="muted">
                {`Counts toward ${component.name} (${Math.round(Number(component.weight) * 10) / 10}%)`}
              </NBText>
            ) : null}
          </>
        ) : (
          <LoadingBlock label="Working out the impact" lines={1} />
        )}
      </Card>

      <SectionHeader title="Study sessions" />
      {blocks.isPending ? (
        <LoadingBlock label="Loading study sessions" lines={2} />
      ) : (
        <ItemBlocks item={{ due_date: row.due_date, status }} blocks={blocks.data ?? []} today={today} />
      )}

      {row.kind !== 'reading' ? (
        <>
          <SectionHeader title="Grade" />
          <ItemScoreCard item={row} />
        </>
      ) : null}

      <SectionHeader title="Details" />
      <Card shadow="sm" style={{ gap: spacing.md }}>
        {reading ? <Detail label="Reading" value={reading} /> : null}
        {row.points_possible !== null ? <Detail label="Points" value={String(Number(row.points_possible))} /> : null}
        {row.assigned_date ? <Detail label="Available from" value={formatLongDate(row.assigned_date)} /> : null}
        {row.description ? <Detail label="Details" value={row.description} /> : null}
        {row.notes ? <Detail label="My notes" value={row.notes} /> : null}
        {row.source_quote ? <Detail label="From the syllabus" value={`“${row.source_quote}”`} /> : null}
        <NBText variant="small" color="muted">
          {SOURCE_LABEL[row.source]}
        </NBText>
      </Card>

      <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
        <Button label="Edit item" variant="secondary" fullWidth onPress={() => setEditing(itemFormFrom(row))} />
        {courseRow ? <Button label={`Open ${courseRow.code ?? 'course'}`} variant="ghost" fullWidth onPress={() => router.push(routes.course(courseRow.id))} /> : null}
        <Button label="Delete item" variant="danger" fullWidth loading={remove.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <NBText variant="label" color="muted">
        {label}
      </NBText>
      <NBText variant="body">{value}</NBText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  start: { alignSelf: 'flex-start', marginTop: 4 },
  flex: { flex: 1 },
  detail: { gap: 2 },
});
