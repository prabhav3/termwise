import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { DayCard } from '@/components/plan/DayCard';
import { RedZoneCard } from '@/components/plan/RedZoneCard';
import { openPlanTab, replaceWeek } from '@/components/plan/routes';
import { Stripes } from '@/components/plan/Stripes';
import {
  Card,
  EmptyState,
  ErrorBanner,
  IconButton,
  LoadingBlock,
  NBText,
  Screen,
  SectionHeader,
  StressPill,
  Tag,
  useToast,
} from '@/components/ui';
import { courseIndex, useRefreshPlan, weekStartFromParam, weekView, type WeekView } from '@/data/plan-views';
import type { EngineCourse } from '@/engine';
import { addDaysISO, formatMinutes, formatShortDate, type ISODate } from '@/lib/dates';
import { errorMessage } from '@/lib/functions';
import { usePlan, type PlanSnapshot } from '@/lib/planner';
import { useTheme } from '@/theme';

function WeekNav({ monday }: { monday: ISODate }) {
  const { spacing } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.xs }]}>
      <IconButton
        icon="chevron.left"
        fallback="‹"
        label="Previous week"
        variant="ghost"
        onPress={() => replaceWeek(addDaysISO(monday, -7))}
      />
      <IconButton
        icon="chevron.right"
        fallback="›"
        label="Next week"
        variant="ghost"
        onPress={() => replaceWeek(addDaysISO(monday, 7))}
      />
    </View>
  );
}

function Summary({ week, today }: { week: WeekView; today: ISODate }) {
  const { radius, borders, spacing, stressColors } = useTheme();
  const { stress } = week;
  const red = stress.level === 'red';
  const current = week.start <= today && today <= week.end;
  const counts = [
    stress.deadlines === 0 ? 'No deadlines' : `${stress.deadlines} ${stress.deadlines === 1 ? 'deadline' : 'deadlines'}`,
    stress.majorDeadlines > 0 ? `${stress.majorDeadlines} major` : null,
    `${formatMinutes(stress.plannedMinutes)} planned of ${formatMinutes(stress.capacityMinutes)} free`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card color={stressColors[stress.level]} shadow="lg" style={{ gap: spacing.sm }}>
      {red ? <Stripes radius={radius.card - borders.standard} /> : null}
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="label" style={styles.grow}>
          {`${formatShortDate(week.start)} – ${formatShortDate(week.end)}`}
        </NBText>
        {current ? <Tag label="This week" color="yellow" /> : null}
      </View>
      <View style={[styles.score, { gap: spacing.md }]}>
        <NBText
          variant="number"
          style={styles.bigNumber}
          accessibilityLabel={`Stress score ${stress.score} out of 100`}
          maxFontSizeMultiplier={1.3}
        >
          {String(stress.score)}
        </NBText>
        <View style={{ gap: spacing.xs, paddingBottom: spacing.sm }}>
          <NBText variant="smallBold">out of 100</NBText>
          <StressPill level={stress.level} score={stress.score} />
        </View>
      </View>
      <NBText variant="bodyMedium">{counts}</NBText>
    </Card>
  );
}

function WeekBody({ snapshot, monday }: { snapshot: PlanSnapshot; monday: ISODate }) {
  const { spacing } = useTheme();
  const week = useMemo(() => weekView(snapshot, monday), [snapshot, monday]);
  const courseById = useMemo<Map<string, EngineCourse>>(() => courseIndex(snapshot.courses), [snapshot.courses]);
  const { stress } = week;

  return (
    <View style={{ gap: spacing.lg }}>
      <Summary week={week} today={snapshot.today} />

      <View>
        <SectionHeader title="What's driving it" style={{ marginTop: spacing.md }} />
        <Card shadow="sm" style={{ gap: spacing.sm }}>
          {stress.drivers.length === 0 ? (
            <NBText variant="body" color="muted">
              Nothing big this week. A good week to get ahead.
            </NBText>
          ) : (
            stress.drivers.map((driver, index) => (
              <View key={driver} style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
                <NBText variant="bodyBold" accessible={false}>
                  {`${index + 1}.`}
                </NBText>
                <NBText variant="body" style={styles.grow}>
                  {driver}
                </NBText>
              </View>
            ))
          )}
        </Card>
      </View>

      {stress.redZones.length > 0 ? (
        <View style={{ gap: spacing.lg }}>
          <SectionHeader title="Red zones" style={{ marginTop: spacing.md, marginBottom: 0 }} />
          {stress.redZones.map((zone) => (
            <RedZoneCard key={`${zone.start}:${zone.end}`} zone={zone} courses={courseById} today={snapshot.today} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: spacing.lg }}>
        <SectionHeader title="Day by day" style={{ marginTop: spacing.md, marginBottom: 0 }} />
        {week.days.map((day) => (
          <DayCard key={day.date} day={day} courses={courseById} scale={week.maxDayMinutes} />
        ))}
      </View>

    </View>
  );
}

export default function WeekScreen() {
  const { colors, spacing } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ start: string }>();
  const monday = weekStartFromParam(params.start);
  const view = usePlan();
  const refresh = useRefreshPlan();
  const title = monday ? `Week of ${formatShortDate(monday)}` : 'Week';

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't refresh your plan", message: errorMessage(error) }),
    });

  return (
    <>
      <Stack.Screen
        options={{ title, headerRight: monday ? () => <WeekNav monday={monday} /> : undefined }}
      />
      <Screen
        edges={['bottom']}
        refreshControl={<RefreshControl refreshing={refresh.isPending} onRefresh={onRefresh} tintColor={colors.ink} />}
      >
        {!monday ? (
          <EmptyState
            tone="pink"
            title="That week doesn't exist"
            message="The link didn't point at a real date. Pick a week from your plan instead."
            actionLabel="Open the plan"
            onAction={openPlanTab}
          />
        ) : view.status === 'loading' ? (
          <View style={{ gap: spacing.lg }}>
            <LoadingBlock label="Loading this week" height={160} lines={3} />
            <LoadingBlock label="Loading days" lines={4} />
          </View>
        ) : view.status === 'error' ? (
          <ErrorBanner title="This week didn't load" message={view.error.message} onRetry={view.retry} />
        ) : (
          <WeekBody snapshot={view} monday={monday} />
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  score: { flexDirection: 'row', alignItems: 'flex-end' },
  bigNumber: { fontSize: 64, lineHeight: 68 },
});
