import { useState } from 'react';
import { RefreshControl } from 'react-native';

import { useTheme } from '@/theme';

/**
 * Pull-to-refresh for screens whose data is remote. `refresh` runs every refetch in parallel;
 * failures are left to each query's own error state.
 */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    refresh()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.ink}
      colors={[colors.primary]}
      progressBackgroundColor={colors.surface}
      accessibilityLabel="Pull to refresh"
    />
  );
}
