// Textbooks found in the syllabus, each with an optional chapter → page map.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChapterMapEditor, invalidChapters } from '@/components/courses/ChapterMapEditor';
import { FieldCell, FieldRow } from '@/components/courses/fields';
import { Button, Card, IconButton, NBText, TextField } from '@/components/ui';
import { chapterMapPages } from '@/lib/import-extraction';
import { useTheme } from '@/theme';

import type { DraftTextbook } from './draft';

export interface DraftTextbooksEditorProps {
  textbooks: DraftTextbook[];
  /** How many readings point at each title (so removing a book says what it affects). */
  readingCount: (title: string) => number;
  onRename: (key: string, title: string) => void;
  onChange: (book: DraftTextbook) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

function chapterSummary(book: DraftTextbook): string {
  if (book.chapters.length === 0) return 'No chapter map yet';
  const pages = chapterMapPages(book.chapters);
  return `${book.chapters.length} chapter${book.chapters.length === 1 ? '' : 's'}${pages > 0 ? ` · ${pages} pages` : ''}`;
}

export function DraftTextbooksEditor({ textbooks, readingCount, onRename, onChange, onRemove, onAdd }: DraftTextbooksEditorProps) {
  const { spacing } = useTheme();
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <View style={{ gap: spacing.md }}>
      {textbooks.length === 0 ? (
        <NBText variant="small" color="muted">
          No textbooks found. Add one if readings say things like “Ch. 4” — a chapter map turns them into page counts.
        </NBText>
      ) : null}
      {textbooks.map((book) => {
        const open = openKey === book.key;
        const readings = book.title.trim() ? readingCount(book.title) : 0;
        const broken = invalidChapters(book.chapters).length;
        return (
          <Card key={book.key} shadow="sm" style={{ gap: spacing.md }}>
            <View style={[styles.header, { gap: spacing.sm }]}>
              <TextField
                label="Title"
                value={book.title}
                placeholder="e.g. Psychology, 6th ed."
                onChangeText={(title) => onRename(book.key, title)}
                error={book.title.trim() ? null : 'Give the book a title'}
                containerStyle={styles.flex}
              />
              <IconButton
                icon="trash"
                fallback="✕"
                label={`Remove ${book.title.trim() || 'this book'}`}
                variant="ghost"
                onPress={() => onRemove(book.key)}
                style={styles.remove}
              />
            </View>
            <FieldRow>
              <FieldCell flex={2}>
                <TextField
                  label="Authors"
                  value={book.authors ?? ''}
                  autoCapitalize="words"
                  onChangeText={(authors) => onChange({ ...book, authors: authors || null })}
                />
              </FieldCell>
              <FieldCell>
                <TextField label="Edition" value={book.edition ?? ''} onChangeText={(edition) => onChange({ ...book, edition: edition || null })} />
              </FieldCell>
            </FieldRow>
            <View style={[styles.summary, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <NBText variant="smallBold">{broken > 0 ? `⚠ ${chapterSummary(book)} · ${broken} to fix` : chapterSummary(book)}</NBText>
                {readings > 0 ? (
                  <NBText variant="small" color="muted">{`Used by ${readings} reading${readings === 1 ? '' : 's'}`}</NBText>
                ) : null}
              </View>
              <Button
                label={open ? 'Hide chapters' : 'Edit chapters'}
                size="sm"
                variant="secondary"
                onPress={() => setOpenKey(open ? null : book.key)}
                accessibilityLabel={`${open ? 'Hide' : 'Edit'} chapters of ${book.title.trim() || 'this book'}`}
              />
            </View>
            {open ? <ChapterMapEditor rows={book.chapters} onChange={(chapters) => onChange({ ...book, chapters })} /> : null}
          </Card>
        );
      })}
      <Button label="Add a textbook" variant="secondary" icon={{ name: 'plus', fallback: '+' }} onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  summary: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  remove: { marginTop: 22 },
});
