import { EmptyState, Screen } from '@/components/ui';

export default function GradesScreen() {
  return (
    <Screen title="Grades" subtitle="Where you stand, and what you need on what's left.">
      <EmptyState
        tone="green"
        title="Nothing graded yet"
        message="Add scores as they come back and see your current grade and what it takes to hit your target."
      />
    </Screen>
  );
}
