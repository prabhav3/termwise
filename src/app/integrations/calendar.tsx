import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { AppleCalendarSection } from '@/components/integrations/AppleCalendarSection';
import { CloudCalendarSection } from '@/components/integrations/CloudCalendarSection';
import { IcsFeedSection } from '@/components/integrations/IcsFeedSection';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { useCloudCalendarConnect } from '@/components/integrations/useCloudCalendarConnect';
import { ErrorBanner, LoadingBlock, Screen } from '@/components/ui';
import { useCalendarConnections } from '@/data';
import { useAuth } from '@/lib/auth';
import { appleQueryKeys, useAppleCalendarAutoSync } from '@/lib/calendar/apple';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

/** termwise://integrations/calendar — also the OAuth return URL (?status=&provider=&message=). */
export default function CalendarIntegrationsScreen() {
  useAppleCalendarAutoSync();
  const { spacing } = useTheme();
  const client = useQueryClient();
  const { profile, refreshProfile } = useAuth();
  const params = useLocalSearchParams<{ status?: string; provider?: string; message?: string }>();
  const connections = useCalendarConnections();
  const cloud = useCloudCalendarConnect();
  const { handleRedirect } = cloud;

  // A redirect that arrived as a deep link (instead of the auth session's result).
  useEffect(() => {
    if (!params.status) return;
    handleRedirect({ status: params.status, provider: params.provider, message: params.message });
    router.setParams({ status: undefined, provider: undefined, message: undefined });
  }, [params.status, params.provider, params.message, handleRedirect]);

  const refreshControl = usePullToRefresh(() =>
    Promise.all([
      connections.refetch(),
      refreshProfile(),
      client.invalidateQueries({ queryKey: appleQueryKeys.permissions }),
    ]),
  );

  const google = connections.data?.find((row) => row.provider === 'google' && row.device_id === '') ?? null;
  const outlook = connections.data?.find((row) => row.provider === 'microsoft' && row.device_id === '') ?? null;

  return (
    <Screen
      title="Calendars"
      subtitle="Pick where your deadlines show up. Each one stays in its own “Termwise” calendar, separate from yours."
      refreshControl={refreshControl}
    >
      <View style={{ gap: spacing.lg }}>
        <AppleCalendarSection />

        {connections.isPending ? (
          <LoadingBlock lines={3} label="Loading Google and Outlook" />
        ) : connections.error ? (
          <ErrorBanner
            title="Couldn't load your calendars"
            message={errorMessage(connections.error)}
            onRetry={() => void connections.refetch()}
          />
        ) : (
          <>
            <CloudCalendarSection
              provider="google"
              connection={google}
              connecting={cloud.connecting === 'google'}
              onConnect={() => void cloud.connect('google')}
            />
            <CloudCalendarSection
              provider="microsoft"
              connection={outlook}
              connecting={cloud.connecting === 'microsoft'}
              onConnect={() => void cloud.connect('microsoft')}
            />
          </>
        )}

        {profile ? <IcsFeedSection icsToken={profile.ics_token} /> : <LoadingBlock lines={2} label="Loading your link" />}
      </View>
    </Screen>
  );
}
