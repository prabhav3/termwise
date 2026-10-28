// Chapter → page map editor (textbook screen, syllabus review, scanned table of contents).
import { randomUUID } from 'expo-crypto';
import { StyleSheet, View } from 'react-native';

import { Button, Card, IconButton, NBText, TextField } from '@/components/ui';
import { chapterMapPages } from '@/lib/import-extraction';
import { useTheme } from '@/theme';
import type { Chapter } from '@/types/db';

import { FieldCell, FieldRow, NumberField } from './fields';

export interface ChapterRow {
  key: string;
  number: string;
  title: string | null;
  start_page: number | null;
  end_page: number | null;
}

export function toChapterRows(chapters: readonly Chapter[]): ChapterRow[] {
  return chapters.map((chapter) => ({ key: randomUUID(), ...chapter }));
}

export function fromChapterRows(rows: readonly ChapterRow[]): Chapter[] {
  return rows
    .filter((row) => row.number.trim())
    .map((row) => ({
      number: row.number.trim(),
      title: row.title?.trim() ? row.title.trim() : null,
      start_page: row.start_page,
      end_page: row.end_page,
    }));
}

/** Chapters whose last page comes before their first. */
export function invalidChapters(rows: readonly ChapterRow[]): ChapterRow[] {
  return rows.filter((row) => row.start_page !== null && row.end_page !== null && row.end_page < row.start_page);
}

function nextRow(rows: readonly ChapterRow[]): ChapterRow {
  const last = rows[rows.length - 1];
  const number = last && /^\d+$/.test(last.number) ? String(Number(last.number) + 1) : last ? '' : '1';
  const start = last?.end_page !== null && last?.end_page !== undefined ? last.end_page + 1 : null;
  return { key: randomUUID(), number, title: null, start_page: start, end_page: null };
}

export function ChapterMapEditor({ rows, onChange }: { rows: ChapterRow[]; onChange: (rows: ChapterRow[]) => void }) {
  const { spacing } = useTheme();
  const pages = chapterMapPages(rows);
  const update = (key: string, patch: Partial<ChapterRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <View style={{ gap: spacing.md }}>
      <NBText variant="small" color="muted">
        {rows.length === 0
          ? 'No chapters yet. Add them by hand or scan the table of contents.'
          : `${rows.length} chapter${rows.length === 1 ? '' : 's'}${pages > 0 ? ` · ${pages} pages mapped` : ''}`}
      </NBText>
      {rows.map((row) => {
        const backwards = row.start_page !== null && row.end_page !== null && row.end_page < row.start_page;
        const count = row.start_page !== null && row.end_page !== null && !backwards ? row.end_page - row.start_page + 1 : null;
        const name = row.number ? `chapter ${row.number}` : 'this chapter';
        return (
          <Card key={row.key} shadow="sm" style={{ gap: spacing.md }}>
            <FieldRow>
              <FieldCell>
                <TextField label="Chapter" value={row.number} placeholder="4" onChangeText={(number) => update(row.key, { number })} />
              </FieldCell>
              <FieldCell flex={2.4}>
                <TextField
                  label="Title"
                  value={row.title ?? ''}
                  placeholder="Optional"
                  onChangeText={(title) => update(row.key, { title })}
                />
              </FieldCell>
            </FieldRow>
            <FieldRow>
              <FieldCell>
                <NumberField
                  label="First page"
                  value={row.start_page}
                  integer
                  min={1}
                  onChange={(start_page) => update(row.key, { start_page })}
                />
              </FieldCell>
              <FieldCell>
                <NumberField
                  label="Last page"
                  value={row.end_page}
                  integer
                  min={1}
                  onChange={(end_page) => update(row.key, { end_page })}
                />
              </FieldCell>
            </FieldRow>
            <View style={[styles.footer, { gap: spacing.sm }]}>
              <NBText variant="smallBold" color={backwards ? 'danger' : 'muted'} style={styles.flex}>
                {backwards ? '⚠ Last page is before the first page' : count !== null ? `${count} pages` : 'Pages unknown'}
              </NBText>
              <IconButton
                icon="trash"
                fallback="✕"
                label={`Remove ${name}`}
                variant="ghost"
                onPress={() => onChange(rows.filter((r) => r.key !== row.key))}
              />
            </View>
          </Card>
        );
      })}
      <Button
        label="Add chapter"
        variant="secondary"
        icon={{ name: 'plus', fallback: '+' }}
        onPress={() => onChange([...rows, nextRow(rows)])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
