import { EmptyState, Screen } from '@/components/ui';

export default function PlanScreen() {
  return (
    <Screen title="Plan" subtitle="Weekly stress, red zones, and every deadline in one calendar.">
      <EmptyState
        tone="blue"
        title="No crunch weeks yet"
        message="Once your courses are in, heavy weeks and 48-hour pile-ups show up here well before they hit."
      />
    </Screen>
  );
}
