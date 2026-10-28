import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SyllabusExtraction, TocExtraction } from '@shared/extraction.ts';

import { goBackOr, param, routes } from '@/components/courses/nav';
import { confirmDiscardUpload } from '@/components/review/confirm';
import { ReviewProgress } from '@/components/review/ReviewProgress';
import { SyllabusReview } from '@/components/review/SyllabusReview';
import { TocReview } from '@/components/review/TocReview';
import { Button, Card, EmptyState, ErrorBanner, Icon, LoadingBlock, NBText, Screen, useToast } from '@/components/ui';
import { useStartParse, useUploadStatus } from '@/data';
import { useDiscardUpload } from '@/data/capture';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { SyllabusUpload } from '@/types/db';

type Reviewable = { kind: 'syllabus'; value: SyllabusExtraction } | { kind: 'toc'; value: TocExtraction };

type Parsed = Reviewable | { kind: 'invalid' } | null;

/** The review on screen while its import runs. */
interface HeldReview {
  upload: SyllabusUpload;
  parsed: Reviewable;
}

function readExtraction(upload: SyllabusUpload | null): Parsed {
  if (!upload || upload.status !== 'needs_review') return null;
  if (upload.kind === 'toc') {
    const result = TocExtraction.safeParse(upload.extraction);
    return result.success ? { kind: 'toc', value: result.data } : { kind: 'invalid' };
  }
  const result = SyllabusExtraction.safeParse(upload.extraction);
  return result.success ? { kind: 'syllabus', value: result.data } : { kind: 'invalid' };
}

export default function ReviewScreen() {
  const params = useLocalSearchParams<{ uploadId: string; textbookId?: string }>();
  const uploadId = param(params.uploadId);
  const textbookId = param(params.textbookId);
  const { spacing } = useTheme();
  const toast = useToast();
  const status = useUploadStatus(uploadId);
  const startParse = useStartParse();
  const discard = useDiscardUpload();
  const upload = status.upload;
  const parsed = useMemo(() => readExtraction(upload), [upload]);
  // An import marks the upload imported before it finishes (cache refresh, replan). The review
  // stays mounted until then: unmounting it would drop the import's toast and navigation.
  const [held, setHeld] = useState<HeldReview | null>(null);
  const what = upload?.kind === 'toc' ? 'table of contents' : 'syllabus';

  const leave = () => goBackOr(routes.coursesTab());

  const retry = () => {
    if (!upload) return;
    startParse.mutate(upload.id, {
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't start reading", message: errorMessage(error) }),
    });
  };

  const discardNow = () => {
    if (!upload) return;
    discard.mutate(upload, {
      onSuccess: () => {
        toast.show({ tone: 'info', title: 'Upload discarded', message: 'Nothing was added to your courses.' });
        leave();
      },
      onError: (error) => toast.show({ tone: 'danger', title: "Couldn't discard it", message: errorMessage(error) }),
    });
  };

  const header = <Stack.Screen options={{ title: upload?.kind === 'toc' ? 'Book contents' : 'Syllabus' }} />;

  if (!uploadId || (!status.isLoading && !upload && !status.loadError)) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <EmptyState
          tone="yellow"
          title="This upload is gone"
          message="It may have been discarded or already added. Your courses are all on the Courses tab."
          actionLabel="Go to Courses"
          onAction={() => router.replace(routes.coursesTab())}
        />
      </Screen>
    );
  }

  if (status.isLoading) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading your upload" height={180} />
          <LoadingBlock label="Loading your upload" lines={3} />
        </View>
      </Screen>
    );
  }

  if (!upload) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <ErrorBanner
          title="Couldn't load this upload"
          message={errorMessage(status.loadError)}
          onRetry={status.refetch}
        />
      </Screen>
    );
  }

  if (upload.status === 'uploaded' || upload.status === 'processing') {
    return (
      <Screen edges={['bottom']}>
        {header}
        <ReviewProgress
          kind={upload.kind}
          note={status.progressNote}
          notStarted={upload.status === 'uploaded' && !startParse.isPending}
          onStart={retry}
          starting={startParse.isPending}
          onLeave={leave}
          onDiscard={() => confirmDiscardUpload(upload.kind, discardNow)}
          discarding={discard.isPending}
        />
      </Screen>
    );
  }

  if (upload.status === 'failed') {
    return (
      <Screen edges={['bottom']}>
        {header}
        <View style={{ gap: spacing.xl }}>
          <Card color="orange" shadow="lg" style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Icon name="exclamationmark.triangle.fill" fallback="⚠" size={26} />
              <NBText variant="h1" style={styles.flex}>
                {`We couldn't read this ${what}`}
              </NBText>
            </View>
            <NBText variant="bodyMedium" accessibilityLiveRegion="polite">
              {status.error ?? 'Something went wrong while reading it.'}
            </NBText>
          </Card>
          <View style={{ gap: spacing.md }}>
            <Button label="Try again" size="lg" fullWidth loading={startParse.isPending} onPress={retry} />
            <Button
              label="Upload something else"
              variant="secondary"
              fullWidth
              onPress={() => router.replace(routes.upload({ kind: upload.kind, courseId: upload.course_id, textbookId }))}
            />
            <Button
              label="Discard"
              variant="ghost"
              fullWidth
              loading={discard.isPending}
              onPress={() => confirmDiscardUpload(upload.kind, discardNow)}
            />
          </View>
        </View>
      </Screen>
    );
  }

  const review: HeldReview | null =
    held?.upload.id === upload.id ? held : parsed && parsed.kind !== 'invalid' ? { upload, parsed } : null;

  if (!review && upload.status === 'imported') {
    const courseId = upload.course_id;
    return (
      <Screen edges={['bottom']}>
        {header}
        <EmptyState
          tone="green"
          title="Already in your plan"
          message={`You've added this ${what}. Edit anything from the course page.`}
          actionLabel={courseId ? 'Open the course' : 'Go to Courses'}
          onAction={() => router.replace(courseId ? routes.course(courseId) : routes.coursesTab())}
        />
      </Screen>
    );
  }

  if (!review) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <View style={{ gap: spacing.lg }}>
          <ErrorBanner
            title="The results didn't come through"
            message={`We read your ${what} but couldn't open what we found. Reading it again usually fixes this.`}
            onRetry={retry}
            retryLabel="Read it again"
          />
          <Button label="Discard" variant="ghost" fullWidth loading={discard.isPending} onPress={() => confirmDiscardUpload(upload.kind, discardNow)} />
        </View>
      </Screen>
    );
  }

  // Held from the first tap until the import fails; on success the screen navigates away.
  const onImportingChange = (importing: boolean) => setHeld(importing ? review : null);

  if (review.parsed.kind === 'toc') {
    return (
      <>
        {header}
        <TocReview
          key={upload.id}
          upload={review.upload}
          extraction={review.parsed.value}
          initialTextbookId={textbookId}
          discarding={discard.isPending}
          onDiscard={discardNow}
          onImportingChange={onImportingChange}
          onSaved={(savedId) => {
            // Started from that textbook's screen: it is right below, showing the new map.
            if (savedId === textbookId && router.canGoBack()) router.back();
            else router.replace(routes.textbook(savedId));
          }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SyllabusReview
        key={upload.id}
        upload={review.upload}
        extraction={review.parsed.value}
        discarding={discard.isPending}
        onDiscard={discardNow}
        onImportingChange={onImportingChange}
        onImported={(courseId) => router.replace(routes.course(courseId))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
