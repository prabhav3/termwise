import { useMemo } from 'react';
import { View } from 'react-native';

import { Card, EmptyState, NBText, SectionHeader, stressLabel } from '@/components/ui';
import { courseIndex } from '@/data/plan-views';
import { formatShortDate } from '@/lib/dates';
import type { PlanSnapshot } from '@/lib/planner';
import { useTheme } from '@/theme';

import { RedZoneCard } from './RedZoneCard';
import { openUpload, openWeek } from './routes';
import { StressStrip } from './StressStrip';

export interface PlanOverviewProps {
  snapshot: PlanSnapshot;
}

/** The 16-week stress strip and every upcoming deadline cluster. */
export function PlanOverview({ snapshot }: PlanOverviewProps) {
  const { spacing } = useTheme();
  const { weekly, redZones, courses, today } = snapshot;
  const courseById = useMemo(() => courseIndex(courses), [courses]);
  const hasCourses = courses.some((course) => !course.archived);

  if (!hasCourses) {
    return (
      <EmptyState
        tone="blue"
        title="No crunch weeks yet"
        message="Once your courses are in, heavy weeks and 48-hour pile-ups show up here well before they hit."
        actionLabel="Add a syllabus"
        onAction={openUpload}
      />
    );
  }

  const heaviest = weekly.reduce<(typeof weekly)[number] | null>(
    (top, week) => (top === null || week.score > top.score ? week : top),
    null,
  );

  return (
    <View>
      <SectionHeader title="Next 16 weeks" style={{ marginTop: spacing.sm }} />
      <NBText variant="small" color="muted" style={{ marginBottom: spacing.md }}>
        {heaviest && heaviest.score > 0
          ? `Heaviest: week of ${formatShortDate(heaviest.week_start)} (${heaviest.score}, ${stressLabel(heaviest.level).toLowerCase()}). Tap any week for the details.`
          : 'Every week looks light so far. Tap any week for the details.'}
      </NBText>
      <StressStrip weeks={weekly} today={today} onSelectWeek={openWeek} />

      <SectionHeader title="Red zones" />
      {redZones.length === 0 ? (
        <Card shadow="sm">
          <NBText variant="bodyBold">No pile-ups ahead.</NBText>
          <NBText variant="small" color="muted" style={{ marginTop: spacing.xs }}>
            Your deadlines are spread out. If three majors ever land within 48 hours, you&apos;ll see it here first.
          </NBText>
        </Card>
      ) : (
        <View style={{ gap: spacing.lg }}>
          {redZones.map((zone) => (
            <RedZoneCard
              key={`${zone.start}:${zone.end}`}
              zone={zone}
              courses={courseById}
              today={today}
              onPress={() => openWeek(zone.start)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
