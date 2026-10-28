// One gradeable item with inline score entry. Tapping the row opens a small editor in place
// (points or percent); saving closes it at once and the grade updates optimistically.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon, NBText, SegmentedControl, Tag, TextField } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { describeDue, type ISODate } from '@/lib/dates';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

import {
  describeScore,
  draftFor,
  formatScoreNumber,
  formatWeight,
  parseDecimal,
  parseScoreDraft,
  type ScoreDraft,
  type ScoreEntryMode,
} from './model';

export interface ScoreRowProps {
  item: Item;
  today: ISODate;
  /** Percent of the course grade this item is worth, when known. */
  weight: number | null;
  dropped: boolean;
  divider: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSave: (item: Item, score: number | null, pointsPossible: number | null) => void;
}

const MODES = [
  { value: 'points', label: 'Points' },
  { value: 'percent', label: 'Percent' },
] as const;

export function ScoreRow({ item, today, weight, dropped, divider, expanded, onToggle, onSave }: ScoreRowProps) {
  const { colors, borders, spacing } = useTheme();
  const summary = describeScore(item);
  const details = [
    item.due_date ? describeDue(item.due_date, today).label : null,
    weight !== null && weight > 0 ? `${formatWeight(weight)} of grade` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const spoken = [
    item.title,
    details || null,
    summary.spoken ?? 'No score yet',
    dropped ? 'Dropped as your lowest score' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={{ borderTopWidth: divider ? borders.hairline : 0, borderTopColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint={expanded ? 'Closes the score editor' : summary.text ? 'Edit this score' : 'Add a score'}
        accessibilityState={{ expanded }}
        onPress={() => {
          haptic('selection');
          onToggle();
        }}
        style={({ pressed }) => [
          styles.row,
          { gap: spacing.md, paddingVertical: spacing.sm },
          pressed ? { backgroundColor: colors.surfaceAlt } : null,
        ]}
      >
        <View style={[styles.text, { gap: 2 }]}>
          <NBText variant="bodyBold" numberOfLines={2} dense>
            {item.title}
          </NBText>
          {details ? (
            <NBText variant="small" color="muted" numberOfLines={1} dense>
              {details}
            </NBText>
          ) : null}
          {dropped ? <Tag label="Dropped · lowest" color="orange" style={{ marginTop: spacing.xs }} /> : null}
        </View>
        {summary.text ? (
          <NBText
            variant="smallBold"
            dense
            numberOfLines={1}
            style={[styles.score, dropped ? { textDecorationLine: 'line-through', color: colors.inkMuted } : null]}
          >
            {summary.text}
          </NBText>
        ) : (
          <View style={[styles.add, { gap: spacing.xs }]}>
            <Icon name="plus.circle.fill" fallback="+" size={18} color={colors.primary} />
            <NBText variant="smallBold" color="primary" dense>
              Add score
            </NBText>
          </View>
        )}
      </Pressable>
      {expanded ? <ScoreEditor item={item} onCancel={onToggle} onSave={onSave} /> : null}
    </View>
  );
}

interface ScoreEditorProps {
  item: Item;
  onCancel: () => void;
  onSave: ScoreRowProps['onSave'];
}

function ScoreEditor({ item, onCancel, onSave }: ScoreEditorProps) {
  const { colors, borders, radius, spacing } = useTheme();
  const [draft, setDraft] = useState<ScoreDraft>(() => draftFor(item));
  const [error, setError] = useState<{ field: 'score' | 'points' | 'percent'; message: string } | null>(null);

  const update = (changes: Partial<ScoreDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };

  const submit = () => {
    const parsed = parseScoreDraft(draft, item);
    if (!parsed.ok) {
      setError({ field: parsed.field, message: parsed.message });
      haptic('warning');
      return;
    }
    onSave(item, parsed.score, parsed.pointsPossible);
  };

  const percentPreview = (() => {
    if (draft.mode !== 'percent' || item.points_possible === null || item.points_possible <= 0) return undefined;
    const percent = parseDecimal(draft.percent);
    if (percent === null || Number.isNaN(percent)) return `Saved as points out of ${formatScoreNumber(item.points_possible)}`;
    return `Saved as ${formatScoreNumber((percent / 100) * item.points_possible)} / ${formatScoreNumber(item.points_possible)}`;
  })();

  return (
    <View
      style={[
        {
          gap: spacing.md,
          padding: spacing.md,
          marginBottom: spacing.md,
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderWidth: borders.hairline,
          borderRadius: radius.control,
        },
      ]}
    >
      <SegmentedControl<ScoreEntryMode>
        options={MODES}
        value={draft.mode}
        onChange={(mode) => update({ mode })}
        accessibilityLabel={`How to enter the score for ${item.title}`}
      />
      {draft.mode === 'points' ? (
        <View style={[styles.fields, { gap: spacing.md }]}>
          <TextField
            label="Score"
            value={draft.score}
            onChangeText={(score) => update({ score })}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={submit}
            placeholder="18"
            autoFocus
            error={error?.field === 'score' ? error.message : null}
            containerStyle={styles.field}
          />
          <TextField
            label="Out of"
            value={draft.points}
            onChangeText={(points) => update({ points })}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={submit}
            placeholder="20"
            error={error?.field === 'points' ? error.message : null}
            containerStyle={styles.field}
          />
        </View>
      ) : (
        <TextField
          label="Percent"
          value={draft.percent}
          onChangeText={(percent) => update({ percent })}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={submit}
          placeholder="87.5"
          autoFocus
          helper={percentPreview}
          error={error?.field === 'percent' ? error.message : null}
        />
      )}
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button label="Save score" size="sm" onPress={submit} />
        <Button label="Cancel" size="sm" variant="secondary" onPress={onCancel} />
        {item.score !== null ? (
          <Button
            label="Clear"
            size="sm"
            variant="ghost"
            accessibilityLabel={`Clear the score for ${item.title}`}
            onPress={() => onSave(item, null, item.points_possible)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  text: { flex: 1 },
  score: { flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  add: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, minHeight: 44 },
  fields: { flexDirection: 'row' },
  field: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
