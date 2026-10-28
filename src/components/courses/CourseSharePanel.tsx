// Study-group link for a course: create (or refresh) the snapshot, open the share sheet, revoke.
import { Alert, Share, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, NBText, useToast } from '@/components/ui';
import { useCreateShareLink, useRevokeShareLink, useShareForCourse, type ShareLinks } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Course } from '@/types/db';

function shareMessage(course: Pick<Course, 'code' | 'title'>, links: ShareLinks): string {
  const name = course.code ? `${course.code} (${course.title})` : course.title;
  // The app link leads; the web preview is for classmates without Termwise yet.
  return `Here's my ${name} timeline on Termwise — every deadline, weight and reading.\n\nOpen in Termwise: ${links.appUrl}\n\nNo app yet? Preview it: ${links.webUrl}`;
}

export function CourseSharePanel({ course }: { course: Course }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const share = useShareForCourse(course.id);
  const create = useCreateShareLink();
  const revoke = useRevokeShareLink();
  const active = share.data ?? null;

  const openSheet = async (links: ShareLinks) => {
    try {
      await Share.share({ title: `${course.code ?? course.title} on Termwise`, message: shareMessage(course, links) });
    } catch (error) {
      toast.show({ tone: 'danger', title: "Couldn't open sharing", message: errorMessage(error) });
    }
  };

  // Creating again refreshes the snapshot behind the same link, so classmates get today's dates.
  const shareNow = () =>
    create.mutate(course.id, {
      onSuccess: ({ links }) => void openSheet(links),
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't make the link", message: errorMessage(error) }),
    });

  const stop = () => {
    if (!active) return;
    Alert.alert('Stop sharing?', 'The link stops working for anyone who hasn’t imported it yet. Classmates who already did keep their copy.', [
      { text: 'Keep sharing', style: 'cancel' },
      {
        text: 'Stop sharing',
        style: 'destructive',
        onPress: () =>
          revoke.mutate(active.id, {
            onSuccess: () => toast.show({ tone: 'info', title: 'Link turned off', message: 'You can make a new one any time.' }),
            onError: (error) => toast.show({ tone: 'danger', title: "Couldn't turn it off", message: errorMessage(error) }),
          }),
      },
    ]);
  };

  return (
    <Card shadow="sm" style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="h3" style={styles.flex}>
          Share with classmates
        </NBText>
        {active ? <Badge label="Link on" tone="green" accessibilityLabel="Share link is on" /> : null}
      </View>
      <NBText variant="small" color="muted">
        {active
          ? `${active.import_count === 0 ? 'No one has' : `${active.import_count} classmate${active.import_count === 1 ? ' has' : 's have'}`} imported it so far. Sharing again sends your latest dates.`
          : 'Send your deadlines, weights and readings to a study group. Your grades, statuses and notes stay private.'}
      </NBText>
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          label={active ? 'Share link' : 'Create a share link'}
          icon={{ name: 'square.and.arrow.up', fallback: '↑' }}
          loading={create.isPending}
          disabled={share.isPending}
          onPress={shareNow}
        />
        {active ? <Button label="Stop sharing" variant="ghost" loading={revoke.isPending} onPress={stop} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  flex: { flex: 1 },
});
