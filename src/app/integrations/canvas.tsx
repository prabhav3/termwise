import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { CanvasConnectResponse } from '@shared/api.ts';

import { CanvasConnectForm } from '@/components/integrations/CanvasConnectForm';
import { CanvasConnection } from '@/components/integrations/CanvasConnection';
import { CanvasCoursePicker } from '@/components/integrations/CanvasCoursePicker';
import { usePullToRefresh } from '@/components/integrations/usePullToRefresh';
import { Button, ErrorBanner, LoadingBlock, Screen } from '@/components/ui';
import { useDiscrepancies, useLmsConnections, useLmsCourses } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';

export default function CanvasScreen() {
  const { spacing } = useTheme();
  const connections = useLmsConnections('canvas');
  const lmsCourses = useLmsCourses();
  const discrepancies = useDiscrepancies({ status: 'open' });
  const [justConnected, setJustConnected] = useState<CanvasConnectResponse | null>(null);
  const [addingSchool, setAddingSchool] = useState(false);

  const refreshControl = usePullToRefresh(() =>
    Promise.all([connections.refetch(), lmsCourses.refetch(), discrepancies.refetch()]),
  );

  const onConnected = (response: CanvasConnectResponse) => {
    setAddingSchool(false);
    setJustConnected(response);
  };

  const rows = connections.data ?? [];
  let body: ReactNode;
  if (connections.isPending) {
    body = <LoadingBlock lines={4} label="Loading Canvas" />;
  } else if (connections.error) {
    body = (
      <ErrorBanner
        title="Couldn't load Canvas"
        message={errorMessage(connections.error)}
        onRetry={() => void connections.refetch()}
      />
    );
  } else if (justConnected) {
    body = (
      <CanvasCoursePicker
        connectionId={justConnected.connection_id}
        courses={justConnected.courses}
        onDone={() => setJustConnected(null)}
        onCancel={() => setJustConnected(null)}
      />
    );
  } else if (rows.length === 0 || addingSchool) {
    body = (
      <View style={{ gap: spacing.lg }}>
        <CanvasConnectForm onConnected={onConnected} />
        {addingSchool ? <Button label="Cancel" variant="ghost" onPress={() => setAddingSchool(false)} /> : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: spacing.xl }}>
        {rows.map((connection) => (
          <CanvasConnection key={connection.id} connection={connection} />
        ))}
        <Button label="Connect another school" variant="ghost" onPress={() => setAddingSchool(true)} />
      </View>
    );
  }

  return (
    <Screen
      title="Canvas"
      subtitle="Assignments, due dates, grade weights and scores — straight from Canvas, checked against your syllabus."
      refreshControl={refreshControl}
    >
      {body}
    </Screen>
  );
}
