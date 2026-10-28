// Breaks, holidays, no-class days and finals from the syllabus. The planner keeps study off these.
import { StyleSheet, View } from 'react-native';

import { TERM_EVENT_KINDS } from '@shared/extraction.ts';

import { FieldCell, FieldRow } from '@/components/courses/fields';
import { Button, Card, Chip, DateField, IconButton, NBText, TextField } from '@/components/ui';
import { useTheme } from '@/theme';
import type { TermEventKind } from '@/types/db';

import { newDraftEvent, type DraftEvent } from './draft';

export const TERM_EVENT_LABEL: Record<TermEventKind, string> = {
  holiday: 'Holiday',
  break: 'Break',
  no_class: 'No class',
  finals_period: 'Finals',
  add_drop: 'Add / drop',
  other: 'Other',
};

export interface TermEventsEditorProps {
  events: DraftEvent[];
  onChange: (events: DraftEvent[]) => void;
  /** Date a new entry starts on (course start, else today). */
  defaultDate: string;
}

export function TermEventsEditor({ events, onChange, defaultDate }: TermEventsEditorProps) {
  const { spacing } = useTheme();
  const update = (key: string, patch: Partial<DraftEvent>) =>
    onChange(events.map((event) => (event.key === key ? { ...event, ...patch } : event)));

  return (
    <View style={{ gap: spacing.md }}>
      {events.length === 0 ? (
        <NBText variant="small" color="muted">
          No breaks or holidays found. Add them so nothing gets planned on a day off.
        </NBText>
      ) : null}
      {events.map((event, index) => {
        const backwards = event.end_date < event.start_date;
        const name = event.title.trim() || `date ${index + 1}`;
        return (
          <Card key={event.key} shadow="sm" style={{ gap: spacing.md }}>
            <View style={[styles.header, { gap: spacing.sm }]}>
              <TextField
                label="Name"
                value={event.title}
                placeholder="e.g. Thanksgiving break"
                autoCapitalize="words"
                onChangeText={(title) => update(event.key, { title })}
                error={event.title.trim() ? null : 'Give it a name'}
                containerStyle={styles.flex}
              />
              <IconButton
                icon="trash"
                fallback="✕"
                label={`Remove ${name}`}
                variant="ghost"
                onPress={() => onChange(events.filter((e) => e.key !== event.key))}
                style={styles.remove}
              />
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel="Kind of date" style={[styles.wrap, { gap: spacing.sm }]}>
              {TERM_EVENT_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  role="radio"
                  label={TERM_EVENT_LABEL[kind]}
                  selected={event.kind === kind}
                  onPress={() => update(event.key, { kind })}
                />
              ))}
            </View>
            <FieldRow>
              <FieldCell>
                <DateField
                  label="From"
                  value={event.start_date}
                  onChange={(start_date) =>
                    update(event.key, { start_date, end_date: event.end_date < start_date ? start_date : event.end_date })
                  }
                />
              </FieldCell>
              <FieldCell>
                <DateField
                  label="To"
                  value={event.end_date}
                  minimumDate={event.start_date}
                  onChange={(end_date) => update(event.key, { end_date })}
                  error={backwards ? 'Before the first day' : null}
                />
              </FieldCell>
            </FieldRow>
          </Card>
        );
      })}
      <Button
        label="Add a break or key date"
        variant="secondary"
        icon={{ name: 'plus', fallback: '+' }}
        onPress={() => onChange([...events, newDraftEvent(defaultDate)])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  remove: { marginTop: 22 },
});
