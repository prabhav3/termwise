import { StyleSheet, View } from 'react-native';

import { Card, Icon, NBText, Sheet, type SymbolName } from '@/components/ui';
import { useTheme, type AccentColor } from '@/theme';

export type AddCourseChoice = 'upload' | 'canvas' | 'manual';

const OPTIONS: { choice: AddCourseChoice; title: string; detail: string; icon: SymbolName; fallback: string; tone: AccentColor }[] = [
  {
    choice: 'upload',
    title: 'Upload syllabus',
    detail: 'PDF, Word, photos or pasted text. We pull out every deadline.',
    icon: 'doc.text.viewfinder',
    fallback: '▤',
    tone: 'yellow',
  },
  {
    choice: 'canvas',
    title: 'Import from Canvas',
    detail: 'Assignments, due dates, weights and scores.',
    icon: 'arrow.down.doc',
    fallback: '↓',
    tone: 'blue',
  },
  {
    choice: 'manual',
    title: 'Add manually',
    detail: 'Type in the course and its grading breakdown.',
    icon: 'square.and.pencil',
    fallback: '✎',
    tone: 'pink',
  },
];

export function AddCourseSheet({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (choice: AddCourseChoice) => void;
}) {
  const { spacing } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a course">
      <View style={{ gap: spacing.md }}>
        {OPTIONS.map((option) => (
          <Card
            key={option.choice}
            color={option.tone}
            shadow="sm"
            onPress={() => onChoose(option.choice)}
            accessibilityLabel={`${option.title}. ${option.detail}`}
          >
            <View style={[styles.row, { gap: spacing.md }]}>
              <Icon name={option.icon} fallback={option.fallback} size={26} />
              <View style={styles.flex}>
                <NBText variant="h3">{option.title}</NBText>
                <NBText variant="small" color="muted">
                  {option.detail}
                </NBText>
              </View>
              <Icon name="chevron.right" fallback="›" size={16} />
            </View>
          </Card>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
