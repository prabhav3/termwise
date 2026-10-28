// Parse jobs at the top of the Courses tab: working (live), ready to review, or failed.
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Icon, NBText, useToast } from '@/components/ui';
import { useDiscardUpload } from '@/data/capture';
import { useStartParse, useUploadStatus } from '@/data/uploads';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Course, SyllabusUpload } from '@/types/db';

export function uploadTitle(upload: Pick<SyllabusUpload, 'kind' | 'source' | 'files'>, course: Pick<Course, 'code' | 'title'> | null): string {
  const what = upload.kind === 'toc' ? 'Table of contents' : 'Syllabus';
  if (course) return `${what} · ${course.code ?? course.title}`;
  if (upload.source === 'canvas') return `${what} from Canvas`;
  if (upload.source === 'paste') return `Pasted ${what.toLowerCase()}`;
  const first = upload.files[0]?.name;
  if (!first) return what;
  return upload.files.length > 1 ? `${first} + ${upload.files.length - 1} more` : first;
}

interface UploadStatusCardProps {
  upload: SyllabusUpload;
  course: Course | null;
  onOpen: () => void;
}

/** Live while the parser works (Realtime + polling), static once it settles. */
export function UploadStatusCard({ upload, course, onOpen }: UploadStatusCardProps) {
  const working = upload.status === 'uploaded' || upload.status === 'processing';
  return working ? <LiveUploadCard upload={upload} course={course} onOpen={onOpen} /> : <SettledUploadCard upload={upload} course={course} onOpen={onOpen} />;
}

function LiveUploadCard({ upload, course, onOpen }: UploadStatusCardProps) {
  const { colors, spacing } = useTheme();
  const status = useUploadStatus(upload.id);
  const current = status.upload ?? upload;
  if (status.settled && current.status !== upload.status) {
    return <SettledUploadCard upload={current} course={course} onOpen={onOpen} />;
  }
  const note = status.progressNote ?? (current.status === 'uploaded' ? 'Waiting to start…' : 'Reading your syllabus…');
  const title = uploadTitle(current, course);
  return (
    <Card onPress={onOpen} shadow="sm" accessibilityLabel={`${title}. Working: ${note}`} accessibilityHint="Shows progress">
      <View style={[styles.row, { gap: spacing.md }]}>
        <ActivityIndicator color={colors.ink} />
        <View style={styles.flex}>
          <NBText variant="bodyBold" numberOfLines={1}>
            {title}
          </NBText>
          <NBText variant="small" color="muted" numberOfLines={2} accessibilityLiveRegion="polite">
            {note}
          </NBText>
        </View>
        <Badge label="Working" tone="blue" />
      </View>
    </Card>
  );
}

function SettledUploadCard({ upload, course, onOpen }: UploadStatusCardProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const startParse = useStartParse();
  const discard = useDiscardUpload();
  const title = uploadTitle(upload, course);

  if (upload.status === 'failed') {
    const message = upload.error ?? "We couldn't read that file.";
    return (
      <Card color="orange" shadow="sm" accessibilityLabel={`${title}. Failed: ${message}`}>
        <View style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.md }]}>
            <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={22} />
            <View style={styles.flex}>
              <NBText variant="bodyBold" numberOfLines={1}>
                {title}
              </NBText>
              <NBText variant="small">{message}</NBText>
            </View>
          </View>
          <View style={[styles.actions, { gap: spacing.sm }]}>
            <Button
              label="Try again"
              size="sm"
              variant="secondary"
              loading={startParse.isPending}
              onPress={() =>
                startParse.mutate(upload.id, {
                  onSuccess: onOpen,
                  onError: (error) => toast.show({ tone: 'danger', title: "Couldn't restart", message: errorMessage(error) }),
                })
              }
            />
            <Button
              label="Discard"
              size="sm"
              variant="ghost"
              loading={discard.isPending}
              onPress={() =>
                discard.mutate(upload, {
                  onError: (error) => toast.show({ tone: 'danger', title: "Couldn't discard", message: errorMessage(error) }),
                })
              }
            />
          </View>
        </View>
      </Card>
    );
  }

  return (
    <Card
      color="green"
      shadow="sm"
      onPress={onOpen}
      accessibilityLabel={`${title}. Ready to review`}
      accessibilityHint="Opens the review screen"
    >
      <View style={[styles.row, { gap: spacing.md }]}>
        <Icon name="checklist" fallback="☑" size={24} />
        <View style={styles.flex}>
          <NBText variant="bodyBold" numberOfLines={1}>
            {title}
          </NBText>
          <NBText variant="small" color="muted">
            Ready to review — check what we found before it goes in your plan.
          </NBText>
        </View>
        <Icon name="chevron.right" fallback="›" size={16} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
