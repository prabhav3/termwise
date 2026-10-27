import { EmptyState, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatLongDate } from '@/lib/dates';
import { useToday } from '@/lib/planner';

export default function TodayScreen() {
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);
  const firstName = profile?.display_name?.trim().split(/\s+/)[0];

  return (
    <Screen eyebrow={formatLongDate(today)} title="Today" subtitle={firstName ? `Hi ${firstName}.` : undefined}>
      <EmptyState
        tone="yellow"
        title="Your top 3 lands here"
        message="Each day you'll see the few things that matter most, with time blocks sized to your schedule."
      />
    </Screen>
  );
}
