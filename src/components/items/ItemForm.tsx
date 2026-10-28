// Every editable field of an item (manual item screen and the item editor).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FieldCell, FieldRow, NumberField } from '@/components/courses/fields';
import { Button, Card, Chip, DateField, NBText, SegmentedControl, TextField, TimeField, Toggle } from '@/components/ui';
import { formatChapterList, formatPageRanges, parseChapterList, parsePageRanges } from '@/lib/import-extraction';
import { useTheme } from '@/theme';
import type { GradingComponent, ReadingRef, Textbook } from '@/types/db';

import { EMPTY_READING, withKind, type ItemFormErrors, type ItemFormValues } from './item-form';
import { KindPicker } from './kinds';

type ImpactChoice = 'auto' | 'high' | 'normal';

const IMPACT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
] as const;

export interface ItemFormProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
  components: readonly GradingComponent[];
  textbooks: readonly Textbook[];
  errors: ItemFormErrors;
}

function ReadingFields({ reading, textbooks, onChange }: { reading: ReadingRef; textbooks: readonly Textbook[]; onChange: (reading: ReadingRef) => void }) {
  const { spacing } = useTheme();
  const [chaptersText, setChaptersText] = useState(() => formatChapterList(reading.chapters));
  const [rangesText, setRangesText] = useState(() => formatPageRanges(reading.page_ranges));
  const set = (patch: Partial<ReadingRef>) => onChange({ ...reading, ...patch });
  const book = textbooks.find((t) => t.id === reading.textbook_id);
  const unmapped = book !== undefined && reading.chapters.length > 0 && book.chapters.length === 0;

  return (
    <Card shadow="none" color="surfaceAlt" style={{ gap: spacing.md }}>
      <NBText variant="h3">Reading</NBText>
      {textbooks.length > 0 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Textbook" style={[styles.wrap, { gap: spacing.sm }]}>
          {textbooks.map((t) => (
            <Chip key={t.id} role="radio" label={t.title} selected={reading.textbook_id === t.id} onPress={() => set({ textbook_id: t.id })} />
          ))}
          <Chip role="radio" label="Other" selected={reading.textbook_id === null} onPress={() => set({ textbook_id: null })} />
        </View>
      ) : null}
      <TextField
        label="Chapters"
        value={chaptersText}
        placeholder="e.g. 4–6, 9"
        helper={unmapped ? 'This book has no chapter map yet, so add page numbers or a page count.' : undefined}
        onChangeText={(text) => {
          setChaptersText(text);
          set({ chapters: parseChapterList(text) });
        }}
      />
      <TextField
        label="Pages"
        value={rangesText}
        placeholder="e.g. 101–126, 140–152"
        keyboardType="numbers-and-punctuation"
        onChangeText={(text) => {
          setRangesText(text);
          set({ page_ranges: parsePageRanges(text) });
        }}
      />
      <NumberField
        label="Total pages"
        value={reading.explicit_pages}
        integer
        min={0}
        placeholder="Work it out"
        onChange={(explicit_pages) => set({ explicit_pages })}
      />
      <TextField
        label="Other reading"
        value={reading.description ?? ''}
        placeholder="e.g. Miller (1956) article"
        onChangeText={(description) => set({ description: description || null })}
      />
    </Card>
  );
}

export function ItemForm({ values, onChange, components, textbooks, errors }: ItemFormProps) {
  const { spacing } = useTheme();
  const set = (patch: Partial<ItemFormValues>) => onChange({ ...values, ...patch });
  const impact: ImpactChoice = values.highImpact === null ? 'auto' : values.highImpact ? 'high' : 'normal';
  const sorted = [...components].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <View style={{ gap: spacing.lg }}>
      <TextField
        label="Title"
        value={values.title}
        placeholder="e.g. Problem Set 3"
        onChangeText={(title) => set({ title })}
        error={errors.title}
        autoCapitalize="sentences"
      />
      <View style={{ gap: spacing.xs }}>
        <NBText variant="label" color="muted">
          Kind
        </NBText>
        <KindPicker value={values.kind} onChange={(kind) => onChange(withKind(values, kind))} />
      </View>

      <View style={{ gap: spacing.sm }}>
        <FieldRow>
          <FieldCell>
            <DateField label="Due" value={values.dueDate} onChange={(dueDate) => set({ dueDate })} placeholder="No date yet" />
          </FieldCell>
          <FieldCell>
            <TimeField
              label="Time"
              value={values.dueTime}
              onChange={(dueTime) => set({ dueTime })}
              placeholder="Any time"
              disabled={values.dueDate === null}
            />
          </FieldCell>
        </FieldRow>
        {values.dueDate ? (
          <Button label="Clear date" size="sm" variant="ghost" onPress={() => set({ dueDate: null, dueTime: null })} style={styles.start} />
        ) : (
          <NBText variant="small" color="muted">
            No date yet? It stays on your list without being planned until you add one.
          </NBText>
        )}
        <DateField
          label="Available from"
          value={values.assignedDate}
          onChange={(assignedDate) => set({ assignedDate })}
          placeholder="Optional"
          maximumDate={values.dueDate ?? undefined}
          error={errors.assignedDate}
        />
      </View>

      {sorted.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <NBText variant="label" color="muted">
            Counts toward
          </NBText>
          <View accessibilityRole="radiogroup" accessibilityLabel="Grade category" style={[styles.wrap, { gap: spacing.sm }]}>
            {sorted.map((component) => (
              <Chip
                key={component.id}
                role="radio"
                label={`${component.name} · ${Math.round(Number(component.weight) * 10) / 10}%`}
                accessibilityLabel={`${component.name}, ${Number(component.weight)} percent`}
                selected={values.componentId === component.id}
                onPress={() => set({ componentId: component.id })}
              />
            ))}
            <Chip role="radio" label="None" selected={values.componentId === null} onPress={() => set({ componentId: null })} />
          </View>
        </View>
      ) : null}

      <FieldRow>
        <FieldCell>
          <NumberField
            label="Worth"
            value={values.weightOverride}
            min={0}
            max={100}
            suffix="%"
            placeholder="From category"
            onChange={(weightOverride) => set({ weightOverride })}
          />
        </FieldCell>
        <FieldCell>
          <NumberField label="Points" value={values.pointsPossible} min={0} placeholder="Optional" onChange={(pointsPossible) => set({ pointsPossible })} />
        </FieldCell>
      </FieldRow>

      {values.kind !== 'reading' ? (
        <NumberField
          label="Work time"
          value={values.estimatedMinutes}
          integer
          min={0}
          max={6000}
          suffix="min"
          placeholder="Estimate for me"
          helper="How long it takes in total. Termwise splits it across days."
          onChange={(estimatedMinutes) => set({ estimatedMinutes })}
        />
      ) : null}

      {values.reading ? (
        <ReadingFields reading={values.reading} textbooks={textbooks} onChange={(reading) => set({ reading })} />
      ) : (
        <Button label="Add reading details" size="sm" variant="ghost" onPress={() => set({ reading: EMPTY_READING })} style={styles.start} />
      )}

      <View style={[styles.toggleRow, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <NBText variant="bodyBold">Major assignment</NBText>
          <NBText variant="small" color="muted">
            Starts earlier, with check-ins along the way.
          </NBText>
        </View>
        <Toggle value={values.isMajor} onValueChange={(isMajor) => set({ isMajor })} accessibilityLabel="Major assignment" />
      </View>

      <View style={{ gap: spacing.xs }}>
        <NBText variant="label" color="muted">
          Impact on your grade
        </NBText>
        <SegmentedControl
          accessibilityLabel="Impact on your grade"
          options={IMPACT_OPTIONS}
          value={impact}
          onChange={(choice) => set({ highImpact: choice === 'auto' ? null : choice === 'high' })}
        />
        <NBText variant="small" color="muted">
          Auto works it out from the weight. High puts it first in your morning triage.
        </NBText>
      </View>

      <TextField
        label="Details"
        value={values.description}
        multiline
        placeholder="What the assignment asks for"
        onChangeText={(description) => set({ description })}
      />
      <TextField label="My notes" value={values.notes} multiline placeholder="Only you see these" onChangeText={(notes) => set({ notes })} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  start: { alignSelf: 'flex-start' },
});
