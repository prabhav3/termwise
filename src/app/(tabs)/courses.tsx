import { EmptyState, Screen } from '@/components/ui';

export default function CoursesScreen() {
  return (
    <Screen title="Courses" subtitle="Syllabi, Canvas courses, and anything you add by hand.">
      <EmptyState
        tone="pink"
        title="Bring in your classes"
        message="Snap or upload a syllabus, connect Canvas, or add a course yourself — Termwise does the rest."
      />
    </Screen>
  );
}
