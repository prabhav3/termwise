import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { MasterCalendar, type MasterCalendarHandle } from '@/components/plan/MasterCalendar';
import { PlanOverview } from '@/components/plan/PlanOverview';
import { Button, ErrorBanner, LoadingBlock, Screen, SegmentedControl, useToast } from '@/components/ui';
import { useRefreshPlan } from '@/data/plan-views';
import { errorMessage } from '@/lib/functions';
import { usePlan } from '@/lib/planner';
import { useTheme } from '@/theme';

type Mode = 'stress' | 'calendar';

const MODES = [
  { value: 'stress', label: 'Stress & red zones' },
  { value: 'calendar', label: 'Calendar' },
] as const;

export default function PlanScreen() {
  const { colors, spacing } = useTheme();
  const toast = useToast();
  const view = usePlan();
  const refresh = useRefreshPlan();
  const [mode, setMode] = useState<Mode>('stress');
  const calendarRef = useRef<MasterCalendarHandle>(null);

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't refresh your plan", message: errorMessage(error) }),
    });
  const refreshControl = <RefreshControl refreshing={refresh.isPending} onRefresh={onRefresh} tintColor={colors.ink} />;

  const showJump = mode === 'calendar' && view.status === 'ready';

  return (
    <Screen
      scroll={false}
      title="Plan"
      headerRight={
        showJump ? (
          <Button
            label="Today"
            accessibilityLabel="Jump to this week"
            variant="secondary"
            size="sm"
            icon={{ name: 'scope', fallback: '◎' }}
            onPress={() => calendarRef.current?.jumpToToday()}
          />
        ) : undefined
      }
      contentContainerStyle={{ paddingBottom: 0 }}
    >
      <SegmentedControl
        options={MODES}
        value={mode}
        onChange={setMode}
        accessibilityLabel="Plan view"
        style={{ marginBottom: spacing.md }}
      />
      {view.status === 'loading' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading your plan" height={180} lines={4} />
          <LoadingBlock label="Loading red zones" lines={2} />
        </ScrollView>
      ) : view.status === 'error' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={refreshControl}>
          <ErrorBanner title="Your plan didn't load" message={view.error.message} onRetry={view.retry} />
        </ScrollView>
      ) : mode === 'calendar' ? (
        <View style={{ flex: 1 }}>
          <MasterCalendar ref={calendarRef} snapshot={view} refreshControl={refreshControl} />
        </View>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={refreshControl}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
        >
          <PlanOverview snapshot={view} />
        </ScrollView>
      )}
    </Screen>
  );
}
