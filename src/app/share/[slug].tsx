import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { param } from '@/components/courses/nav';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { summarizeSnapshot } from '@/components/share/model';
import {
  ShareImportActions,
  ShareImportPanel,
  ShareLinkGone,
  useExistingCopy,
  useShareImport,
} from '@/components/share/ShareImport';
import { NextItems, ShareCounts, SharedCourseCard } from '@/components/share/SharePreview';
import { ErrorBanner, LoadingBlock, Screen } from '@/components/ui';
import { useSharedTimeline } from '@/data';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/functions';
import { useToday } from '@/lib/planner';
import { useTheme } from '@/theme';

/** termwise://share/<slug> — a classmate's course timeline: preview, pick a term, import. */
export default function SharedTimelineScreen() {
  const { spacing } = useTheme();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = param(params.slug) ?? '';
  const { profile } = useAuth();
  const today = useToday(profile?.timezone);

  const shared = useSharedTimeline(slug || null);
  const snapshot = shared.data?.snapshot ?? null;
  const flow = useShareImport(slug, snapshot);
  const existing = useExistingCopy(slug);
  const refreshControl = usePullToRefresh(() => Promise.all([shared.refetch(), flow.terms.refetch()]));

  const header = <Stack.Screen options={{ title: 'Shared course' }} />;

  if (!slug) {
    return (
      <Screen>
        {header}
        <ShareLinkGone incomplete />
      </Screen>
    );
  }

  if (shared.isPending) {
    return (
      <Screen eyebrow="Shared by a classmate" title="Opening the link…">
        {header}
        <LoadingBlock lines={5} label="Loading the shared course" />
      </Screen>
    );
  }

  if (shared.error) {
    return (
      <Screen eyebrow="Shared by a classmate" title="Shared course" refreshControl={refreshControl}>
        {header}
        <ErrorBanner
          title="Couldn't open this link"
          message={errorMessage(shared.error)}
          onRetry={() => void shared.refetch()}
        />
      </Screen>
    );
  }

  if (!shared.data || !snapshot) {
    return (
      <Screen refreshControl={refreshControl}>
        {header}
        <ShareLinkGone />
      </Screen>
    );
  }

  const summary = summarizeSnapshot(snapshot, today);
  const courseName = snapshot.course.code ?? snapshot.course.title;

  return (
    <Screen
      eyebrow="Shared by a classmate"
      title="Import this course?"
      subtitle="Check it’s your section, pick a term, and Termwise plans it with the rest of your work."
      refreshControl={refreshControl}
      footer={<ShareImportActions flow={flow} existing={existing} />}
    >
      {header}
      <View style={{ gap: spacing.lg }}>
        <SharedCourseCard course={snapshot.course} importCount={shared.data.import_count} />
        <ShareCounts summary={summary} />
        <NextItems summary={summary} today={today} />
        <ShareImportPanel flow={flow} existing={existing} courseName={courseName} />
      </View>
    </Screen>
  );
}
