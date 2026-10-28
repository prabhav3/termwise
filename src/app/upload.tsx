import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { CapturedList } from '@/components/capture/CapturedList';
import { SourceGrid, type CaptureSource } from '@/components/capture/SourceGrid';
import { param, routes } from '@/components/courses/nav';
import { CoursePicker } from '@/components/courses/pickers';
import {
  Button,
  Card,
  ErrorBanner,
  NBText,
  Screen,
  SectionHeader,
  SegmentedControl,
  TextField,
  Toggle,
  useToast,
} from '@/components/ui';
import { useCourses } from '@/data';
import { useSubmitCapture } from '@/data/capture';
import { errorMessage } from '@/lib/functions';
import {
  discardLocalCopies,
  MAX_IMAGES,
  pickDocuments,
  pickPhotos,
  takePhoto,
  type CapturedFile,
  type PickOutcome,
} from '@/lib/uploads';
import { useTheme } from '@/theme';

type Kind = 'syllabus' | 'toc';

const KIND_OPTIONS = [
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'toc', label: 'Book contents' },
] as const;

const MIN_PASTE_CHARS = 40;

function askForNextPage(added: number): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `${added} ${added === 1 ? 'page' : 'pages'} added`,
      'Photograph the next page too?',
      [
        { text: 'Done', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Next page', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

export default function UploadScreen() {
  const { spacing } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ kind?: string; courseId?: string; textbookId?: string }>();
  const textbookId = param(params.textbookId);
  const courses = useCourses();
  const submit = useSubmitCapture();

  const [kind, setKind] = useState<Kind>(param(params.kind) === 'toc' ? 'toc' : 'syllabus');
  const [courseId, setCourseId] = useState<string | null>(param(params.courseId));
  const [forExisting, setForExisting] = useState(param(params.courseId) !== null);
  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<CaptureSource | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const imageCount = files.filter((file) => file.kind === 'image').length;
  const submitting = submit.isPending;
  const needsCourse = kind === 'toc' || forExisting;
  const courseList = courses.data ?? [];
  const pastedText = pasteOpen ? pasted.trim() : '';
  const hasContent = files.length > 0 || pastedText.length > 0;

  /** Adds picked files; `imagesBefore` is how many photos are already queued. */
  const addOutcome = (outcome: PickOutcome, imagesBefore: number): number => {
    const room = Math.max(0, MAX_IMAGES - imagesBefore);
    let images = 0;
    const accepted = outcome.files.filter((file) => file.kind !== 'image' || ++images <= room);
    const dropped = outcome.files.filter((file) => !accepted.includes(file));
    discardLocalCopies(dropped);
    setFormError(null);
    setProblems(
      dropped.length > 0
        ? [...outcome.problems, `Up to ${MAX_IMAGES} photos per upload — the extra ones were left out.`]
        : outcome.problems,
    );
    if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
    return accepted.filter((file) => file.kind === 'image').length;
  };

  const run = async (source: CaptureSource, task: () => Promise<void>) => {
    setBusy(source);
    try {
      await task();
    } catch (error) {
      setProblems([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const shootPages = async () => {
    let page = files.filter((file) => file.origin === 'camera').length + 1;
    let added = 0;
    for (;;) {
      const result = await takePhoto(page);
      if (result.status === 'denied') {
        Alert.alert('Camera is off for Termwise', 'Allow camera access in Settings to photograph pages.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      if (result.status === 'canceled') return;
      added += addOutcome(result.outcome, imageCount + added);
      page += 1;
      if (imageCount + added >= MAX_IMAGES) return;
      if (!(await askForNextPage(added))) return;
    }
  };

  const pick = (source: CaptureSource) => {
    if (source === 'paste') {
      setPasteOpen((open) => !open);
      return;
    }
    if (source === 'files') {
      void run('files', async () => {
        const outcome = await pickDocuments();
        if (outcome) addOutcome(outcome, imageCount);
      });
    } else if (source === 'photos') {
      void run('photos', async () => {
        const outcome = await pickPhotos(imageCount);
        if (outcome) addOutcome(outcome, imageCount);
      });
    } else {
      void run('camera', shootPages);
    }
  };

  const move = (key: string, delta: -1 | 1) =>
    setFiles((current) => {
      const index = current.findIndex((file) => file.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = (key: string) =>
    setFiles((current) => {
      const removed = current.filter((file) => file.key === key);
      discardLocalCopies(removed);
      return current.filter((file) => file.key !== key);
    });

  const start = () => {
    if (needsCourse && !courseId) {
      setFormError(kind === 'toc' ? 'Pick the course this book belongs to.' : 'Pick the course, or turn off "For an existing course".');
      return;
    }
    if (!hasContent) {
      setFormError('Add a file, some photos, or paste the text first.');
      return;
    }
    if (files.length === 0 && pastedText.length < MIN_PASTE_CHARS) {
      setFormError('That pasted text is very short. Paste the whole syllabus, or add a file instead.');
      return;
    }
    setFormError(null);
    submit.mutate(
      {
        kind,
        courseId: needsCourse ? courseId : null,
        files,
        pastedText: pastedText || null,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: ({ uploadId, parseError }) => {
          discardLocalCopies(files);
          if (parseError) toast.show({ tone: 'warning', title: "Couldn't start reading yet", message: parseError.message });
          router.replace(routes.review(uploadId, kind === 'toc' ? textbookId : null));
        },
        onSettled: () => setProgress(null),
      },
    );
  };

  const progressText =
    progress && progress.total > 0 && progress.done < progress.total
      ? `Uploading ${progress.done + 1} of ${progress.total}…`
      : submitting
        ? 'Starting the reader…'
        : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: kind === 'toc' ? 'Scan contents' : 'Add a syllabus',
          gestureEnabled: !submitting,
          headerRight: submitting
            ? undefined
            : () => <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />,
        }}
      />
      <Screen
        edges={['bottom']}
        footer={
          <View style={{ gap: spacing.sm }}>
            {progressText ? (
              <NBText variant="smallBold" align="center" accessibilityLiveRegion="polite">
                {progressText}
              </NBText>
            ) : null}
            <Button
              label={kind === 'toc' ? 'Read the contents' : 'Read my syllabus'}
              size="lg"
              fullWidth
              loading={submitting}
              disabled={!hasContent || busy !== null}
              onPress={start}
              accessibilityHint="Uploads everything and starts reading it"
            />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <SegmentedControl
            accessibilityLabel="What are you adding?"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(value) => setKind(value)}
          />
          <NBText variant="body" color="muted">
            {kind === 'toc'
              ? 'Photograph the table of contents so readings like “Ch. 4–7” turn into real page counts.'
              : 'Add the whole syllabus — every page. We pull out deadlines, weights, readings and breaks for you to check.'}
          </NBText>

          <SourceGrid onPick={pick} busy={busy} pasteOpen={pasteOpen} />

          {problems.length > 0 ? (
            <ErrorBanner tone="warning" title="Some files weren't added" message={problems.join('\n')} />
          ) : null}

          {files.length > 0 ? <CapturedList files={files} onMove={move} onRemove={remove} /> : null}

          {pasteOpen ? (
            <TextField
              label="Pasted text"
              value={pasted}
              onChangeText={setPasted}
              placeholder="Paste the syllabus text here"
              multiline
              autoCorrect={false}
              helper={pasted.trim().length > 0 ? `${pasted.trim().length} characters` : 'Long is fine — paste all of it.'}
            />
          ) : null}

          <SectionHeader title={kind === 'toc' ? 'Which course?' : 'Course'} />
          {kind === 'syllabus' ? (
            <Card shadow="sm" style={{ gap: spacing.md }}>
              <View style={[styles.toggleRow, { gap: spacing.md }]}>
                <View style={styles.flex}>
                  <NBText variant="bodyBold">For an existing course</NBText>
                  <NBText variant="small" color="muted">
                    We fill in what&apos;s missing and keep your edits.
                  </NBText>
                </View>
                <Toggle
                  value={forExisting}
                  onValueChange={setForExisting}
                  accessibilityLabel="This syllabus is for an existing course"
                  disabled={courseList.length === 0}
                />
              </View>
              {forExisting && courseList.length > 0 ? (
                <CoursePicker courses={courseList} value={courseId} onChange={setCourseId} />
              ) : null}
              {courseList.length === 0 ? (
                <NBText variant="small" color="muted">
                  We&apos;ll create the course from the syllabus.
                </NBText>
              ) : null}
            </Card>
          ) : courseList.length > 0 ? (
            <CoursePicker courses={courseList} value={courseId} onChange={setCourseId} label="Textbook for" />
          ) : (
            <ErrorBanner tone="warning" title="Add a course first" message="Textbooks belong to a course. Add the course, then scan its book." />
          )}

          {formError ? <ErrorBanner message={formError} /> : null}
          {submit.error ? <ErrorBanner title="Upload didn't finish" message={errorMessage(submit.error)} onRetry={start} /> : null}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
