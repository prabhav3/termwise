// A course's textbooks with their chapter-map status, plus adding one by hand or by scanning.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, ListRow, NBText, Sheet, TextField, useToast } from '@/components/ui';
import { useCreateTextbook } from '@/data';
import { errorMessage } from '@/lib/functions';
import { chapterMapPages } from '@/lib/import-extraction';
import { useTheme } from '@/theme';
import type { Textbook } from '@/types/db';

import { routes } from './nav';

/** Lets the sheet finish dismissing before the next screen is pushed. */
const SHEET_DISMISS_MS = 280;

export function textbookSummary(book: Pick<Textbook, 'chapters'>): string {
  if (book.chapters.length === 0) return 'No chapter map yet — add one for page counts';
  const pages = chapterMapPages(book.chapters);
  return `${book.chapters.length} chapter${book.chapters.length === 1 ? '' : 's'}${pages > 0 ? ` · ${pages} pages mapped` : ''}`;
}

export function CourseTextbooks({ courseId, textbooks }: { courseId: string; textbooks: readonly Textbook[] }) {
  const { spacing, colors } = useTheme();
  const toast = useToast();
  const create = useCreateTextbook();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const close = () => {
    setAdding(false);
    setSubmitted(false);
  };

  const save = () => {
    setSubmitted(true);
    if (!title.trim()) return;
    create.mutate(
      { course_id: courseId, title: title.trim(), authors: authors.trim() || null, chapters: [] },
      {
        onSuccess: (book) => {
          close();
          setTitle('');
          setAuthors('');
          setTimeout(() => router.push(routes.textbook(book.id)), SHEET_DISMISS_MS);
        },
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't add the book", message: errorMessage(error) }),
      },
    );
  };

  return (
    <View style={{ gap: spacing.md }}>
      {textbooks.length > 0 ? (
        <Card padded={false} shadow="sm">
          {textbooks.map((book, index) => (
            <ListRow
              key={book.id}
              title={book.title}
              subtitle={textbookSummary(book)}
              left={<Icon name="book.closed.fill" fallback="▥" size={22} color={colors.ink} />}
              onPress={() => router.push(routes.textbook(book.id))}
              divider={index > 0}
              accessibilityHint="Opens the chapter page map"
            />
          ))}
        </Card>
      ) : (
        <NBText variant="small" color="muted">
          No textbooks yet. Add one so readings like “Ch. 4–6” become real page counts.
        </NBText>
      )}
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button label="Add a textbook" size="sm" variant="secondary" icon={{ name: 'plus', fallback: '+' }} onPress={() => setAdding(true)} />
        <Button
          label="Scan contents"
          size="sm"
          variant="ghost"
          icon={{ name: 'camera', fallback: '◉' }}
          onPress={() => router.push(routes.upload({ kind: 'toc', courseId }))}
          accessibilityHint="Photograph a table of contents to make a chapter map"
        />
      </View>

      <Sheet
        visible={adding}
        onClose={close}
        title="Add a textbook"
        footer={<Button label="Add and map chapters" fullWidth loading={create.isPending} onPress={save} />}
      >
        <View style={{ gap: spacing.md }}>
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Psychology, 6th ed."
            error={submitted && !title.trim() ? 'Give the book a title' : null}
            autoFocus
          />
          <TextField label="Authors" value={authors} onChangeText={setAuthors} autoCapitalize="words" placeholder="Optional" />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
