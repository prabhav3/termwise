import { useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref } from 'react';
import { SectionList, View, type RefreshControlProps } from 'react-native';

import { Button, EmptyState, NBText } from '@/components/ui';
import {
  calendarWeeks,
  courseIndex,
  datedConflicts,
  itemIndex,
  undatedConflict,
  type CalendarFilters as Filters,
  type CalendarRow,
  type CalendarWeek,
} from '@/data/plan-views';
import type { PlanSnapshot } from '@/lib/planner';
import { useTheme } from '@/theme';

import { CalendarFilters } from './CalendarFilters';
import { CalendarRowView, WeekHeader } from './CalendarRows';
import { ConflictsCard, UnscheduledCard } from './ConflictsCard';
import { openItem, openUpload, openWeek } from './routes';

export interface MasterCalendarHandle {
  jumpToToday: () => void;
}

export interface MasterCalendarProps {
  snapshot: PlanSnapshot;
  refreshControl: ReactElement<RefreshControlProps>;
  ref?: Ref<MasterCalendarHandle>;
}

const NO_FILTERS: Filters = { courseIds: [], majorsOnly: false };
const MAX_JUMP_RETRIES = 3;

/**
 * Every dated item from every active course plus the merged term events, as an agenda grouped
 * by week. Past weeks stay folded away until asked for, so the list opens on this week.
 */
export function MasterCalendar({ snapshot, refreshControl, ref }: MasterCalendarProps) {
  const { spacing } = useTheme();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showPast, setShowPast] = useState(false);
  const listRef = useRef<SectionList<CalendarRow, CalendarWeek>>(null);
  const retries = useRef(0);

  const { masterCalendar, plan, weekly, today, courses } = snapshot;
  const courseById = useMemo(() => courseIndex(courses), [courses]);
  const items = useMemo(() => itemIndex(plan.annotated), [plan.annotated]);
  const activeCourses = useMemo(() => courses.filter((course) => !course.archived), [courses]);
  const weeks = useMemo(
    () => calendarWeeks(masterCalendar, plan.annotated, weekly, today, filters),
    [masterCalendar, plan.annotated, weekly, today, filters],
  );
  const conflicts = useMemo(() => datedConflicts(masterCalendar), [masterCalendar]);
  const undated = useMemo(() => undatedConflict(masterCalendar), [masterCalendar]);

  const pastCount = weeks.filter((week) => week.isPast).length;
  const sections = showPast ? weeks : weeks.filter((week) => !week.isPast);
  const currentIndex = Math.max(
    0,
    sections.findIndex((week) => week.isCurrent),
  );

  const scrollToCurrent = () => {
    if (sections.length === 0) return;
    listRef.current?.scrollToLocation({ sectionIndex: currentIndex, itemIndex: 0, viewOffset: 0, animated: true });
  };

  useImperativeHandle(ref, () => ({
    jumpToToday: () => {
      retries.current = 0;
      scrollToCurrent();
    },
  }));

  if (activeCourses.length === 0) {
    return (
      <EmptyState
        tone="blue"
        title="Your year, in one calendar"
        message="Add a syllabus and every exam, paper and break from every course lands here — with clashes flagged."
        actionLabel="Add a syllabus"
        onAction={openUpload}
      />
    );
  }

  const filtered = filters.courseIds.length > 0 || filters.majorsOnly;

  return (
    <SectionList<CalendarRow, CalendarWeek>
      ref={listRef}
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      initialNumToRender={24}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      renderSectionHeader={({ section }) => <WeekHeader week={section} onPress={() => openWeek(section.weekStart)} />}
      renderItem={({ item }) => <CalendarRowView row={item} courses={courseById} onOpenItem={openItem} />}
      onScrollToIndexFailed={(info) => {
        // Sections far down are not measured yet: get close, then try again once they render.
        listRef.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
        if (retries.current >= MAX_JUMP_RETRIES) return;
        retries.current += 1;
        setTimeout(scrollToCurrent, 120);
      }}
      ListHeaderComponent={
        <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
          <CalendarFilters courses={activeCourses} value={filters} onChange={setFilters} />
          <ConflictsCard conflicts={conflicts} onOpenItem={openItem} />
          {pastCount > 0 ? (
            <Button
              label={showPast ? 'Hide earlier weeks' : `Show ${pastCount} earlier ${pastCount === 1 ? 'week' : 'weeks'}`}
              variant="secondary"
              size="sm"
              icon={showPast ? { name: 'chevron.down', fallback: '⌄' } : { name: 'chevron.up', fallback: '⌃' }}
              onPress={() => setShowPast((value) => !value)}
            />
          ) : null}
        </View>
      }
      ListFooterComponent={
        <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
          {filtered ? (
            <NBText variant="small" color="muted" align="center">
              Filters are on — some deadlines are hidden.
            </NBText>
          ) : null}
          <UnscheduledCard conflict={undated} items={items} courses={courseById} onOpenItem={openItem} />
        </View>
      }
    />
  );
}
