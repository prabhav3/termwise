// Edits one draft item: everything the parser found, plus the syllabus quote it came from.
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { ExtractedReading } from '@shared/extraction.ts';

import { FieldCell, FieldRow, NumberField } from '@/components/courses/fields';
import { KindPicker } from '@/components/items/kinds';
import { Button, Card, Chip, DateField, NBText, Sheet, TextField, TimeField, Toggle } from '@/components/ui';
import { formatChapterList, formatPageRanges, parseChapterList, parsePageRanges } from '@/lib/import-extraction';
import { useTheme } from '@/theme';

import { LOW_CONFIDENCE, type DraftItem } from './draft';

const EMPTY_READING: ExtractedReading = {
  textbook_title: null,
  chapters: [],
  page_ranges: [],
  explicit_pages: null,
  description: null,
};

export interface DraftItemSheetProps {
  item: DraftItem | null;
  componentNames: string[];
  textbookTitles: string[];
  onChange: (item: DraftItem) => void;
  onDelete: (key: string) => void;
  onClose: () => void;
}

export function DraftItemSheet({ item, componentNames, textbookTitles, onChange, onDelete, onClose }: DraftItemSheetProps) {
  return (
    <Sheet visible={item !== null} onClose={onClose} title={item?.title.trim() ? 'Edit item' : 'New item'}>
      {item ? (
        <DraftItemForm
          key={item.key}
          item={item}
          componentNames={componentNames}
          textbookTitles={textbookTitles}
          onChange={onChange}
          onDelete={onDelete}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function DraftItemForm({ item, componentNames, textbookTitles, onChange, onDelete, onClose }: DraftItemSheetProps & { item: DraftItem }) {
  const { spacing } = useTheme();
  const { height } = useWindowDimensions();
  const [chaptersText, setChaptersText] = useState(() => formatChapterList(item.reading?.chapters ?? []));
  const [rangesText, setRangesText] = useState(() => formatPageRanges(item.reading?.page_ranges ?? []));
  const set = (patch: Partial<DraftItem>) => onChange({ ...item, ...patch });
  const reading = item.reading ?? EMPTY_READING;
  const setReading = (patch: Partial<ExtractedReading>) => set({ reading: { ...reading, ...patch } });
  const showReading = item.kind === 'reading' || item.reading !== null;
  const lowConfidence = item.confidence < LOW_CONFIDENCE;

  return (
    <>
      <ScrollView style={{ flexShrink: 1, maxHeight: height * 0.62 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
        {item.source_quote ? (
          <Card color={lowConfidence ? 'orange' : 'surfaceAlt'} shadow="none" style={{ gap: spacing.xs }}>
            <NBText variant="label">{lowConfidence ? 'Please check — from the syllabus' : 'From the syllabus'}</NBText>
            <NBText variant="bodyMedium">{`“${item.source_quote}”`}</NBText>
          </Card>
        ) : null}
        <TextField
          label="Title"
          value={item.title}
          placeholder="e.g. Problem Set 3"
          onChangeText={(title) => set({ title })}
          error={item.title.trim() ? null : 'Give it a title'}
        />
        <View style={{ gap: spacing.xs }}>
          <NBText variant="label" color="muted">
            Kind
          </NBText>
          <KindPicker value={item.kind} onChange={(kind) => set({ kind })} />
        </View>
        <FieldRow>
          <FieldCell>
            <DateField label="Due" value={item.due_date} onChange={(due_date) => set({ due_date })} placeholder="No date" />
          </FieldCell>
          <FieldCell>
            <TimeField label="Time" value={item.due_time} onChange={(due_time) => set({ due_time })} placeholder="Any time" />
          </FieldCell>
        </FieldRow>
        {item.due_date === null && item.date_text ? (
          <NBText variant="small" color="muted">{`The syllabus says: “${item.date_text}”`}</NBText>
        ) : null}
        {item.due_date || item.due_time ? (
          <Button label="Clear date" size="sm" variant="ghost" onPress={() => set({ due_date: null, due_time: null })} />
        ) : null}
        {componentNames.length > 0 ? (
          <View style={{ gap: spacing.xs }}>
            <NBText variant="label" color="muted">
              Counts toward
            </NBText>
            <View accessibilityRole="radiogroup" accessibilityLabel="Grade category" style={[styles.wrap, { gap: spacing.sm }]}>
              {componentNames.map((name) => (
                <Chip key={name} role="radio" label={name} selected={item.component_name === name} onPress={() => set({ component_name: name })} />
              ))}
              <Chip role="radio" label="None" selected={item.component_name === null} onPress={() => set({ component_name: null })} />
            </View>
          </View>
        ) : null}
        <FieldRow>
          <FieldCell>
            <NumberField
              label="Weight"
              value={item.weight_percent}
              min={0}
              max={100}
              suffix="%"
              placeholder="Auto"
              onChange={(weight_percent) => set({ weight_percent })}
            />
          </FieldCell>
          <FieldCell>
            <NumberField label="Points" value={item.points_possible} min={0} onChange={(points_possible) => set({ points_possible })} />
          </FieldCell>
        </FieldRow>
        <View style={[styles.toggleRow, { gap: spacing.md }]}>
          <View style={styles.flex}>
            <NBText variant="bodyBold">Major assignment</NBText>
            <NBText variant="small" color="muted">
              Gets an earlier start and check-ins in your plan.
            </NBText>
          </View>
          <Toggle value={item.is_major} onValueChange={(is_major) => set({ is_major })} accessibilityLabel="Major assignment" />
        </View>
        {item.kind !== 'reading' ? (
          <NumberField
            label="Work time"
            value={item.estimated_minutes}
            integer
            min={0}
            max={6000}
            suffix="min"
            placeholder="Estimate for me"
            onChange={(estimated_minutes) => set({ estimated_minutes })}
          />
        ) : null}

        {showReading ? (
          <Card shadow="none" color="surfaceAlt" style={{ gap: spacing.md }}>
            <NBText variant="h3">Reading</NBText>
            {textbookTitles.length > 0 ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Textbook" style={[styles.wrap, { gap: spacing.sm }]}>
                {textbookTitles.map((title) => (
                  <Chip
                    key={title}
                    role="radio"
                    label={title}
                    selected={reading.textbook_title === title}
                    onPress={() => setReading({ textbook_title: title })}
                  />
                ))}
                <Chip role="radio" label="Other" selected={reading.textbook_title === null} onPress={() => setReading({ textbook_title: null })} />
              </View>
            ) : null}
            <TextField
              label="Chapters"
              value={chaptersText}
              placeholder="e.g. 4–6, 9"
              helper={reading.chapters.length > 0 ? `${reading.chapters.length} chapter${reading.chapters.length === 1 ? '' : 's'}` : undefined}
              onChangeText={(text) => {
                setChaptersText(text);
                setReading({ chapters: parseChapterList(text) });
              }}
            />
            <TextField
              label="Pages"
              value={rangesText}
              placeholder="e.g. 101–126, 140–152"
              keyboardType="numbers-and-punctuation"
              onChangeText={(text) => {
                setRangesText(text);
                setReading({ page_ranges: parsePageRanges(text) });
              }}
            />
            <NumberField
              label="Total pages"
              value={reading.explicit_pages}
              integer
              min={0}
              placeholder="Work it out"
              onChange={(explicit_pages) => setReading({ explicit_pages })}
            />
            <TextField
              label="Other reading"
              value={reading.description ?? ''}
              placeholder="e.g. Miller (1956) article"
              onChangeText={(description) => setReading({ description: description || null })}
            />
          </Card>
        ) : (
          <Button label="Add reading details" size="sm" variant="ghost" onPress={() => set({ reading: EMPTY_READING })} />
        )}
        {/* items.description: share links include it, so it is not labelled as private notes. */}
        <TextField
          label="Details"
          value={item.description ?? ''}
          multiline
          placeholder="What the assignment asks for"
          onChangeText={(description) => set({ description: description || null })}
        />
      </ScrollView>
      <FieldRow>
        <FieldCell>
          <Button
            label="Delete"
            variant="danger"
            fullWidth
            onPress={() => onDelete(item.key)}
            accessibilityLabel={`Delete ${item.title || 'this item'}`}
          />
        </FieldCell>
        <FieldCell>
          <Button label="Done" fullWidth onPress={onClose} />
        </FieldCell>
      </FieldRow>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
