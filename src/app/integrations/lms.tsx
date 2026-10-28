import { useState } from 'react';
import { View } from 'react-native';

import { LmsConnectForm, LmsFeedCard } from '@/components/integrations/LmsFeed';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { Button, ErrorBanner, LoadingBlock, Screen, SectionHeader } from '@/components/ui';
import { useLmsConnections, useLmsCourses } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

/** Blackboard / Moodle / any LMS with an iCal calendar feed: date checks against the syllabus. */
export default function LmsFeedsScreen() {
  const { spacing } = useTheme();
  const connections = useLmsConnections();
  const lmsCourses = useLmsCourses();
  const [adding, setAdding] = useState(false);

  const refreshControl = usePullToRefresh(() => Promise.all([connections.refetch(), lmsCourses.refetch()]));
  const feeds = (connections.data ?? []).filter((connection) => connection.provider !== 'canvas');
  const showForm = adding || feeds.length === 0;

  return (
    <Screen
      title="LMS feeds"
      subtitle="Blackboard, Moodle and most other LMSs publish a calendar link. Termwise reads it to catch dates that differ from your syllabus."
      refreshControl={refreshControl}
    >
      {connections.isPending ? (
        <LoadingBlock lines={4} label="Loading your feeds" />
      ) : connections.error ? (
        <ErrorBanner
          title="Couldn't load your feeds"
          message={errorMessage(connections.error)}
          onRetry={() => void connections.refetch()}
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {feeds.map((connection) => (
            <LmsFeedCard key={connection.id} connection={connection} />
          ))}

          {feeds.length > 0 ? (
            <SectionHeader
              title={showForm ? 'Add another feed' : 'More feeds'}
              actionLabel={showForm ? 'Cancel' : undefined}
              onAction={showForm ? () => setAdding(false) : undefined}
            />
          ) : null}
          {showForm ? (
            <LmsConnectForm onConnected={() => setAdding(false)} />
          ) : (
            <Button label="Add another LMS feed" variant="secondary" fullWidth onPress={() => setAdding(true)} />
          )}
        </View>
      )}
    </Screen>
  );
}
