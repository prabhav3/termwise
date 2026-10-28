// A scanned table of contents: check the chapter → page map, then save it to a course's textbook.
import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TocExtraction } from '@shared/extraction.ts';
import { normalizeTitle } from '@shared/match.ts';

import { ChapterMapEditor, fromChapterRows, invalidChapters, toChapterRows, type ChapterRow } from '@/components/courses/ChapterMapEditor';
import { FieldCell, FieldRow } from '@/components/courses/fields';
import { CoursePicker } from '@/components/courses/pickers';
import { Button, Card, Chip, ErrorBanner, LoadingBlock, NBText, Screen, SectionHeader, TextField, useToast } from '@/components/ui';
import { useCourses, useTextbooks } from '@/data';
import { useImportToc } from '@/data/capture';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { SyllabusUpload, Textbook } from '@/types/db';

import { confirmDiscardUpload } from './confirm';
import type { DraftWarning } from './draft';
import { WarningsCard } from './WarningsCard';

const NEW_BOOK = 'new';

export interface TocReviewProps {
  upload: SyllabusUpload;
  extraction: TocExtraction;
  /** The textbook the scan was started from (textbook screen → Scan table of contents). */
  initialTextbookId: string | null;
  onSaved: (textbookId: string) => void;
  /**
   * true when a save starts, false when it fails. The save marks the upload imported before it
   * settles, so the screen keeps this review mounted meanwhile (its callbacks need it).
   */
  onImportingChange: (importing: boolean) => void;
  onDiscard: () => void;
  discarding: boolean;
}

function guessBook(books: readonly Textbook[], initialId: string | null, title: string): string {
  if (initialId && books.some((book) => book.id === initialId)) return initialId;
  const wanted = normalizeTitle(title);
  const match = wanted ? books.find((book) => normalizeTitle(book.title) === wanted) : undefined;
  return match?.id ?? NEW_BOOK;
}

export function TocReview({ upload, extraction, initialTextbookId, onSaved, onImportingChange, onDiscard, discarding }: TocReviewProps) {
  const { spacing } = useTheme();
  const toast = useToast();
  const courses = useCourses();
  const allBooks = useTextbooks();
  const save = useImportToc();

  const initialCourse = upload.course_id ?? allBooks.data?.find((book) => book.id === initialTextbookId)?.course_id ?? null;
  const [courseId, setCourseId] = useState<string | null>(null);
  const [bookPick, setBookPick] = useState<string | null>(null);
  const [title, setTitle] = useState(extraction.textbook.title);
  const [authors, setAuthors] = useState(extraction.textbook.authors ?? '');
  const [rows, setRows] = useState<ChapterRow[]>(() => toChapterRows(extraction.textbook.chapters));
  const [warnings, setWarnings] = useState<DraftWarning[]>(() => extraction.warnings.map((warning) => ({ ...warning, key: randomUUID() })));
  const [submitted, setSubmitted] = useState(false);

  const course = courseId ?? initialCourse;
  const books = (allBooks.data ?? []).filter((book) => book.course_id === course);
  const bookId = bookPick ?? guessBook(books, initialTextbookId, extraction.textbook.title);
  const existing = bookId === NEW_BOOK ? null : (books.find((book) => book.id === bookId) ?? null);
  const broken = invalidChapters(rows);
  const chapters = fromChapterRows(rows);

  const problems: string[] = [];
  if (!course) problems.push('Pick the course this book belongs to.');
  if (!existing && !title.trim()) problems.push('Give the book a title.');
  if (chapters.length === 0) problems.push('Add at least one chapter.');
  if (broken.length > 0) problems.push('A chapter ends before it starts.');

  const submit = () => {
    setSubmitted(true);
    if (problems.length > 0 || !course) return;
    onImportingChange(true);
    save.mutate(
      {
        upload,
        book: { title: title.trim(), authors: authors.trim() || null, edition: extraction.textbook.edition, chapters },
        courseId: course,
        existing,
        warnings: warnings.map(({ key: _key, ...warning }) => warning),
      },
      {
        onSuccess: ({ textbookId }) => {
          toast.show({
            tone: 'success',
            title: existing ? 'Chapter map updated' : 'Textbook added',
            message: `${chapters.length} chapters mapped. Readings now use real page counts.`,
          });
          onSaved(textbookId);
        },
        onError: () => onImportingChange(false),
      },
    );
  };

  return (
    <Screen
      eyebrow="Check the contents"
      title={existing?.title ?? (title.trim() || 'Textbook')}
      subtitle="Make sure each chapter's first and last page look right."
      edges={['bottom']}
      footer={
        <Button
          label={existing ? 'Update chapter map' : 'Save textbook'}
          size="lg"
          fullWidth
          loading={save.isPending}
          onPress={submit}
        />
      }
    >
      <View style={{ gap: spacing.lg }}>
        <WarningsCard
          warnings={warnings}
          items={[]}
          onOpenItem={() => undefined}
          onOpenGrading={() => undefined}
          onDismiss={(key) => setWarnings((current) => current.filter((warning) => warning.key !== key))}
        />

        <Card style={{ gap: spacing.md }}>
          {courses.isPending ? (
            <LoadingBlock label="Loading your courses" lines={1} />
          ) : (
            <CoursePicker
              courses={courses.data ?? []}
              value={course}
              onChange={(next) => {
                setCourseId(next);
                setBookPick(null);
              }}
              label="Textbook for"
            />
          )}
          {course ? (
            <View style={{ gap: spacing.sm }}>
              <NBText variant="label" color="muted">
                Save to
              </NBText>
              <View accessibilityRole="radiogroup" accessibilityLabel="Which textbook" style={[styles.wrap, { gap: spacing.sm }]}>
                {books.map((book) => (
                  <Chip key={book.id} role="radio" label={book.title} selected={bookId === book.id} onPress={() => setBookPick(book.id)} />
                ))}
                <Chip
                  role="radio"
                  label="New book"
                  icon={{ name: 'plus', fallback: '+' }}
                  selected={bookId === NEW_BOOK}
                  onPress={() => setBookPick(NEW_BOOK)}
                />
              </View>
            </View>
          ) : null}
          {existing ? (
            <NBText variant="small" color="muted">
              {existing.chapters.length > 0
                ? `Replaces its current map of ${existing.chapters.length} chapters.`
                : 'Adds a chapter map to this book.'}
            </NBText>
          ) : (
            <FieldRow>
              <FieldCell flex={2}>
                <TextField label="Book title" value={title} onChangeText={setTitle} error={submitted && !title.trim() ? 'Give the book a title' : null} />
              </FieldCell>
              <FieldCell>
                <TextField label="Authors" value={authors} onChangeText={setAuthors} autoCapitalize="words" />
              </FieldCell>
            </FieldRow>
          )}
        </Card>

        {submitted && problems.length > 0 ? <ErrorBanner title="A few things to fix first" message={problems.join('\n')} /> : null}
        {save.error ? <ErrorBanner title="Couldn't save the chapters" message={errorMessage(save.error)} onRetry={submit} /> : null}

        <SectionHeader title="Chapters" />
        <ChapterMapEditor rows={rows} onChange={setRows} />

        <Button
          label="Discard this scan"
          variant="ghost"
          fullWidth
          loading={discarding}
          onPress={() => confirmDiscardUpload('toc', onDiscard)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
