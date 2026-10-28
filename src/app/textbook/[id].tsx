import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ChapterMapEditor, fromChapterRows, invalidChapters, toChapterRows, type ChapterRow } from '@/components/courses/ChapterMapEditor';
import { FieldCell, FieldRow } from '@/components/courses/fields';
import { goBackOr, param, routes } from '@/components/courses/nav';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, NBText, Screen, SectionHeader, TextField, useToast } from '@/components/ui';
import { useCourse, useDeleteTextbook, useItems, useTextbook, useUpdateTextbook } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Textbook } from '@/types/db';

interface BookDraft {
  title: string;
  authors: string;
  rows: ChapterRow[];
}

function draftFrom(book: Textbook): BookDraft {
  return { title: book.title, authors: book.authors ?? '', rows: toChapterRows(book.chapters) };
}

function duplicateNumbers(rows: readonly ChapterRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const number = row.number.trim().toLowerCase();
    if (!number) continue;
    if (seen.has(number)) dupes.add(row.number.trim());
    seen.add(number);
  }
  return [...dupes];
}

export default function TextbookScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = param(params.id);
  const { spacing } = useTheme();
  const toast = useToast();
  const book = useTextbook(id);
  const row = book.data ?? null;
  const course = useCourse(row?.course_id);
  const items = useItems(row?.course_id ?? null);
  const save = useUpdateTextbook();
  const remove = useDeleteTextbook();

  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Load the book, and pick up a new chapter map (e.g. a scanned table of contents) unless the
  // student is in the middle of editing.
  if (row && row.updated_at !== syncedAt && !dirty) {
    setSyncedAt(row.updated_at);
    setDraft(draftFrom(row));
  }

  const header = <Stack.Screen options={{ title: 'Textbook' }} />;

  if (book.isPending) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <View style={{ gap: spacing.lg }}>
          <LoadingBlock label="Loading the textbook" lines={2} />
          <LoadingBlock label="Loading the textbook" lines={4} />
        </View>
      </Screen>
    );
  }
  if (book.error) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <ErrorBanner title="Couldn't load the textbook" message={errorMessage(book.error)} onRetry={() => void book.refetch()} />
      </Screen>
    );
  }
  if (!row || !draft) {
    return (
      <Screen edges={['bottom']}>
        {header}
        <EmptyState
          tone="yellow"
          title="Textbook not found"
          message="It may have been deleted."
          actionLabel="Go to Courses"
          onAction={() => router.replace(routes.coursesTab())}
        />
      </Screen>
    );
  }

  const edit = (patch: Partial<BookDraft>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const broken = invalidChapters(draft.rows);
  const dupes = duplicateNumbers(draft.rows);
  const readings = (items.data ?? []).filter((item) => item.reading?.textbook_id === row.id);
  const courseRow = course.data ?? null;
  const titleError = submitted && !draft.title.trim() ? 'Give the book a title' : null;

  const submit = () => {
    setSubmitted(true);
    if (!draft.title.trim() || broken.length > 0) return;
    save.mutate(
      { id: row.id, changes: { title: draft.title.trim(), authors: draft.authors.trim() || null, chapters: fromChapterRows(draft.rows) } },
      {
        onSuccess: (saved) => {
          setDirty(false);
          setSubmitted(false);
          setSyncedAt(saved.updated_at);
          setDraft(draftFrom(saved));
          toast.show({
            tone: 'success',
            title: 'Chapter map saved',
            message: readings.length > 0 ? `${readings.length} reading${readings.length === 1 ? '' : 's'} now use these pages.` : 'Readings from this book will use these pages.',
          });
        },
      },
    );
  };

  const discardEdits = () => {
    setDirty(false);
    setSubmitted(false);
    setSyncedAt(row.updated_at);
    setDraft(draftFrom(row));
  };

  const confirmDelete = () =>
    Alert.alert(`Delete “${row.title}”?`, 'Readings from it keep their chapters but lose page counts until you add the book again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(row.id, {
            onSuccess: () => {
              toast.show({ tone: 'info', title: 'Textbook deleted', message: `${row.title} is gone.` });
              goBackOr(routes.course(row.course_id));
            },
            onError: (error) => toast.show({ tone: 'danger', title: "Couldn't delete it", message: errorMessage(error) }),
          }),
      },
    ]);

  const scan = () => {
    if (dirty) {
      Alert.alert('Save your changes first?', 'A scanned table of contents replaces this chapter map.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Scan anyway', style: 'destructive', onPress: () => router.push(routes.upload({ kind: 'toc', courseId: row.course_id, textbookId: row.id })) },
      ]);
      return;
    }
    router.push(routes.upload({ kind: 'toc', courseId: row.course_id, textbookId: row.id }));
  };

  return (
    <Screen
      edges={['bottom']}
      eyebrow={courseRow ? (courseRow.code ?? courseRow.title) : undefined}
      title={row.title}
      subtitle={readings.length > 0 ? `Used by ${readings.length} reading${readings.length === 1 ? '' : 's'}.` : 'Map chapters to pages so readings get real page counts.'}
      footer={
        dirty ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Save chapter map" size="lg" fullWidth loading={save.isPending} onPress={submit} />
            <Button label="Discard changes" variant="ghost" fullWidth disabled={save.isPending} onPress={discardEdits} />
          </View>
        ) : undefined
      }
    >
      {header}
      <View style={{ gap: spacing.lg }}>
        {save.error ? <ErrorBanner title="Couldn't save" message={errorMessage(save.error)} onRetry={submit} /> : null}
        {submitted && broken.length > 0 ? (
          <ErrorBanner tone="warning" title="Check the page numbers" message={`${broken.length} chapter${broken.length === 1 ? ' ends' : 's end'} before it starts.`} />
        ) : null}
        {dupes.length > 0 ? (
          <ErrorBanner tone="warning" title="Repeated chapter numbers" message={`Chapter ${dupes.join(', ')} appears more than once. Readings use the first one.`} />
        ) : null}

        <Card style={{ gap: spacing.md }}>
          <FieldRow>
            <FieldCell flex={2}>
              <TextField label="Title" value={draft.title} onChangeText={(title) => edit({ title })} error={titleError} />
            </FieldCell>
            <FieldCell>
              <TextField label="Authors" value={draft.authors} onChangeText={(authors) => edit({ authors })} autoCapitalize="words" />
            </FieldCell>
          </FieldRow>
        </Card>

        <Card color="yellow" shadow="sm" style={{ gap: spacing.sm }}>
          <NBText variant="h3">Faster: scan the contents page</NBText>
          <NBText variant="small" color="muted">
            Take a photo of the table of contents and we fill in every chapter&apos;s pages for you to check.
          </NBText>
          <Button
            label="Scan table of contents"
            variant="secondary"
            icon={{ name: 'camera', fallback: '◉' }}
            onPress={scan}
          />
        </Card>
      </View>

      <SectionHeader title="Chapters" />
      <ChapterMapEditor rows={draft.rows} onChange={(rows) => edit({ rows })} />

      <View style={{ marginTop: spacing.xxl }}>
        <Button label="Delete textbook" variant="danger" fullWidth loading={remove.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}
