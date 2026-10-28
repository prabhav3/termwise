import { RefreshControl, View } from 'react-native';

import { openFocus } from '@/components/plan/routes';
import { useLocalHour } from '@/components/today/hooks';
import { TodayBody } from '@/components/today/TodayBody';
import { ErrorBanner, IconButton, LoadingBlock, Screen, useToast } from '@/components/ui';
import { blocksForDate, greetingFor, useRefreshPlan } from '@/data/plan-views';
import { useAuth } from '@/lib/auth';
import { formatLongDate, formatMinutes } from '@/lib/dates';
import { errorMessage } from '@/lib/functions';
import { usePlan, useToday } from '@/lib/planner';
import { useTheme } from '@/theme';

export default function TodayScreen() {
  const { colors, spacing } = useTheme();
  const toast = useToast();
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const hour = useLocalHour(profile?.timezone);
  const view = usePlan();
  const refresh = useRefreshPlan();
  const firstName = profile?.display_name?.trim().split(/\s+/)[0];
  const greeting = greetingFor(hour);

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't refresh your plan", message: errorMessage(error) }),
    });

  let subtitle: string | undefined;
  if (view.status === 'ready') {
    const planned = blocksForDate(view.plan, view.today).filter((block) => block.status === 'planned');
    const minutes = planned.reduce((sum, block) => sum + block.minutes, 0);
    subtitle =
      planned.length > 0
        ? `${formatMinutes(minutes)} planned across ${planned.length} ${planned.length === 1 ? 'block' : 'blocks'}.`
        : undefined;
  }

  return (
    <Screen
      eyebrow={formatLongDate(today)}
      title={firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
      subtitle={subtitle}
      headerRight={
        <IconButton icon="timer" fallback="◷" label="Start a focus session" onPress={() => openFocus()} />
      }
      refreshControl={<RefreshControl refreshing={refresh.isPending} onRefresh={onRefresh} tintColor={colors.ink} />}
    >
      {view.status === 'loading' ? (
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading today's top 3" height={150} lines={3} />
          <LoadingBlock label="Loading today's top 3" height={150} lines={3} />
          <LoadingBlock label="Loading today's plan" lines={4} />
        </View>
      ) : view.status === 'error' ? (
        <ErrorBanner title="Today didn't load" message={view.error.message} onRetry={view.retry} />
      ) : (
        <TodayBody snapshot={view} />
      )}
    </Screen>
  );
}
