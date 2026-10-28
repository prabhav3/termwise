import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { RedZoneCard } from '@/components/plan/RedZoneCard';
import { openFocus, openItem, openPlanTab, openUpload, openWeek } from '@/components/plan/routes';
import { EmptyState, NBText, ProgressBar, SectionHeader, useToast } from '@/components/ui';
import { useItemsWithExternalChanges, useSetItemStatus } from '@/data';
import {
  blocksForDate,
  carriedOver,
  courseIndex,
  itemIndex,
  sortedOverflow,
  upcomingZone,
} from '@/data/plan-views';
import type { EngineBlock, TriageAction } from '@/engine';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { haptic } from '@/lib/haptics';
import { useMarkBlockDone, useMarkBlockMissed, type PlanSnapshot } from '@/lib/planner';
import { useTheme } from '@/theme';

import { BlockChecklist, type PendingAction } from './BlockChecklist';
import { useDismissedForDay } from './hooks';
import { CarryOverNotice, ExternalChangesCard, OverflowNotice } from './Notices';
import { TriageCard } from './TriageCard';

export interface TodayBodyProps {
  snapshot: PlanSnapshot;
}

/** Triage actions with no block today only offer "done" when finishing the item is the step. */
function itemDoneAllowed(action: TriageAction): boolean {
  return action.reason === 'overdue' || action.reason === 'due_today';
}

/** Today only: the top 3, today's checklist, and the few notes that need attention now. */
export function TodayBody({ snapshot }: TodayBodyProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const markDone = useMarkBlockDone();
  const markMissed = useMarkBlockMissed();
  const setItemStatus = useSetItemStatus();
  const externalChanges = useItemsWithExternalChanges();
  const [pending, setPending] = useState<ReadonlyMap<string, PendingAction>>(new Map());
  const [doneItems, setDoneItems] = useState<ReadonlySet<string>>(new Set());

  const { plan, triage, redZones, today, courses } = snapshot;
  const courseById = useMemo(() => courseIndex(courses), [courses]);
  const items = useMemo(() => itemIndex(plan.annotated), [plan.annotated]);
  const blocks = useMemo(() => blocksForDate(plan, today), [plan, today]);
  const carry = useMemo(() => carriedOver(plan, today), [plan, today]);
  const overflow = useMemo(() => sortedOverflow(plan), [plan]);
  const zone = upcomingZone(redZones, today, 7);
  const [carryHidden, hideCarry] = useDismissedForDay('carryOver', profile?.id, today);

  const hasCourses = courses.some((course) => !course.archived);
  const changes = externalChanges.data ?? [];

  const setPendingKey = (key: string, action: PendingAction | null) =>
    setPending((current) => {
      const next = new Map(current);
      if (action) next.set(key, action);
      else next.delete(key);
      return next;
    });

  // Both pass the block as shown: the planner checks it is the stored work before changing it.
  const completeBlock = (block: EngineBlock) => {
    setPendingKey(block.key, 'done');
    markDone
      .mutateAsync(block)
      .then(() => haptic('success'))
      .catch((error: unknown) =>
        toast.show({ tone: 'danger', title: "Couldn't check that off", message: errorMessage(error) }),
      )
      .finally(() => setPendingKey(block.key, null));
  };

  const missBlock = (block: EngineBlock) => {
    setPendingKey(block.key, 'missed');
    markMissed
      .mutateAsync(block)
      .then(({ summary }) => toast.show({ tone: 'info', title: 'Rescheduled', message: summary, duration: 5000 }))
      .catch((error: unknown) =>
        toast.show({ tone: 'danger', title: "Couldn't move that block", message: errorMessage(error) }),
      )
      .finally(() => setPendingKey(block.key, null));
  };

  const completeItem = (action: TriageAction) => {
    setDoneItems((current) => new Set(current).add(action.item_id));
    const title = items.get(action.item_id)?.title ?? 'That';
    setItemStatus
      .mutateAsync({ id: action.item_id, status: 'done' })
      .then(() => toast.show({ tone: 'success', title: 'Nice', message: `${title} is marked done.` }))
      .catch((error: unknown) => {
        setDoneItems((current) => {
          const next = new Set(current);
          next.delete(action.item_id);
          return next;
        });
        toast.show({ tone: 'danger', title: "Couldn't mark it done", message: errorMessage(error) });
      });
  };

  if (!hasCourses) {
    return (
      <EmptyState
        tone="yellow"
        title="Let's build your semester"
        message="Add a syllabus — PDF, Word doc, photos or Canvas — and each morning you'll see the few things that matter most."
        actionLabel="Add a syllabus"
        onAction={openUpload}
      />
    );
  }

  const nothingToday = triage.length === 0 && blocks.length === 0;
  const doneCount = blocks.filter((block) => (pending.get(block.key) ?? block.status) === 'done').length;

  return (
    <View style={{ gap: spacing.lg }}>
      <ExternalChangesCard items={changes} courses={courseById} onOpenItem={openItem} />

      {zone ? (
        <RedZoneCard zone={zone} courses={courseById} today={today} compact onPress={() => openWeek(zone.start)} />
      ) : null}

      {nothingToday ? (
        <EmptyState
          tone="green"
          title="Nothing due today"
          message="No study blocks and nothing urgent. Enjoy the breathing room — or peek at the week ahead."
          actionLabel="See this week"
          onAction={() => openWeek(today)}
        />
      ) : null}

      {triage.length > 0 ? (
        <View style={{ gap: spacing.lg }}>
          <SectionHeader
            title={triage.length === 1 ? 'Your one thing' : `Your top ${triage.length}`}
            style={{ marginTop: spacing.sm, marginBottom: 0 }}
          />
          {triage.map((action, index) => {
            const blockKey = action.block_key;
            const block = blockKey !== null ? plan.blocks.find((b) => b.key === blockKey) : undefined;
            const done =
              doneItems.has(action.item_id) || (blockKey !== null && (pending.get(blockKey) ?? block?.status) === 'done');
            const canDoneItem = blockKey === null && itemDoneAllowed(action);
            return (
              <TriageCard
                key={action.key}
                action={action}
                rank={index + 1}
                course={courseById.get(action.course_id)}
                done={done}
                busy={blockKey !== null && pending.has(blockKey)}
                doneLabel={blockKey ? 'Done' : 'Mark done'}
                onOpen={() => openItem(action.item_id)}
                onStartFocus={
                  blockKey
                    ? () => openFocus({ blockKey })
                    : action.reason !== 'overdue'
                      ? () => openFocus({ itemId: action.item_id, minutes: action.minutes })
                      : undefined
                }
                onDone={block ? () => completeBlock(block) : canDoneItem ? () => completeItem(action) : undefined}
              />
            );
          })}
        </View>
      ) : null}

      {carry && !carryHidden ? <CarryOverNotice carry={carry} onDismiss={hideCarry} /> : null}

      {blocks.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Today's plan" style={{ marginTop: spacing.sm, marginBottom: 0 }} />
          <View style={{ gap: spacing.xs }}>
            <NBText variant="smallBold" color="muted">
              {doneCount === blocks.length ? 'All done for today. Go rest.' : `${doneCount} of ${blocks.length} done`}
            </NBText>
            <ProgressBar value={blocks.length > 0 ? doneCount / blocks.length : 0} label="Today's progress" />
          </View>
          <BlockChecklist
            blocks={blocks}
            courses={courseById}
            pending={pending}
            onDone={completeBlock}
            onMissed={missBlock}
            onFocus={(block) => openFocus({ blockKey: block.key })}
            onOpenItem={(block) => openItem(block.item_id)}
          />
        </View>
      ) : null}

      {overflow.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Running out of room" style={{ marginTop: spacing.sm, marginBottom: 0 }} />
          <OverflowNotice
            warnings={overflow}
            items={items}
            courses={courseById}
            onOpenItem={openItem}
            onSeeAll={openPlanTab}
          />
        </View>
      ) : null}
    </View>
  );
}
