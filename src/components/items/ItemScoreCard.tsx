// Score entry for one item ("18 out of 20"). Scores feed the Grades tab, not the plan.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FieldCell, FieldRow, NumberField } from '@/components/courses/fields';
import { Button, Card, NBText, useToast } from '@/components/ui';
import { useSetItemScore } from '@/data';
import { errorMessage } from '@/lib/functions';
import { useTheme } from '@/theme';
import type { Item } from '@/types/db';

const num = (value: number | null): number | null => (value === null ? null : Number(value));

export function ItemScoreCard({ item }: { item: Item }) {
  const { spacing } = useTheme();
  const toast = useToast();
  const save = useSetItemScore();
  const [score, setScore] = useState<number | null>(num(item.score));
  const [points, setPoints] = useState<number | null>(num(item.points_possible));
  const [synced, setSynced] = useState(item.updated_at);

  // Saved elsewhere (Canvas sync, the Grades tab): show the new numbers.
  if (synced !== item.updated_at) {
    setSynced(item.updated_at);
    setScore(num(item.score));
    setPoints(num(item.points_possible));
  }

  const changed = score !== num(item.score) || points !== num(item.points_possible);
  const percent = score !== null && points !== null && points > 0 ? Math.round((score / points) * 1000) / 10 : null;
  const saved = num(item.score);

  const submit = (next: number | null) =>
    save.mutate(
      { id: item.id, score: next, pointsPossible: points },
      {
        onSuccess: () => toast.show({ tone: 'success', title: next === null ? 'Score cleared' : 'Score saved', message: 'Your grade is updated.' }),
        onError: (error) => toast.show({ tone: 'danger', title: "Couldn't save the score", message: errorMessage(error) }),
      },
    );

  return (
    <Card shadow="sm" style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <NBText variant="h3" style={styles.flex}>
          Score
        </NBText>
        {percent !== null ? (
          <NBText variant="h2" accessibilityLabel={`${percent} percent`}>
            {`${percent}%`}
          </NBText>
        ) : null}
      </View>
      <FieldRow>
        <FieldCell>
          <NumberField label="You got" value={score} min={0} placeholder="Not graded" onChange={setScore} />
        </FieldCell>
        <FieldCell>
          <NumberField label="Out of" value={points} min={0} placeholder="Points" onChange={setPoints} />
        </FieldCell>
      </FieldRow>
      {score !== null && points === null ? (
        <NBText variant="small" color="muted">
          Without “out of”, the score is read as a percent.
        </NBText>
      ) : null}
      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button label="Save score" size="sm" disabled={!changed} loading={save.isPending} onPress={() => submit(score)} />
        {saved !== null ? <Button label="Clear" size="sm" variant="ghost" disabled={save.isPending} onPress={() => submit(null)} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
