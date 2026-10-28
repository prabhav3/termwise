import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card, Icon, NBText, type SymbolName } from '@/components/ui';
import { useTheme, type AccentColor } from '@/theme';

export type CaptureSource = 'files' | 'photos' | 'camera' | 'paste';

const SOURCES: { source: CaptureSource; title: string; detail: string; icon: SymbolName; fallback: string; tone: AccentColor }[] = [
  { source: 'files', title: 'Files', detail: 'PDF, Word, text', icon: 'folder', fallback: '▤', tone: 'yellow' },
  { source: 'photos', title: 'Photos', detail: 'Pick pages in order', icon: 'photo.on.rectangle', fallback: '▣', tone: 'blue' },
  { source: 'camera', title: 'Camera', detail: 'Snap each page', icon: 'camera', fallback: '◉', tone: 'pink' },
  { source: 'paste', title: 'Paste text', detail: 'From a site or email', icon: 'doc.on.clipboard', fallback: '¶', tone: 'green' },
];

export interface SourceGridProps {
  onPick: (source: CaptureSource) => void;
  /** The source currently opening or converting (shows a spinner; other taps are ignored). */
  busy: CaptureSource | null;
  pasteOpen: boolean;
}

/** Four big capture buttons in a 2 × 2 grid. */
export function SourceGrid({ onPick, busy, pasteOpen }: SourceGridProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.grid, { gap: spacing.md }]}>
      {SOURCES.map((option) => {
        const active = busy === option.source;
        const selected = option.source === 'paste' && pasteOpen;
        return (
          <View key={option.source} style={styles.cell}>
            <Card
              color={option.tone}
              shadow={selected ? 'none' : 'md'}
              onPress={() => {
                if (busy === null) onPick(option.source);
              }}
              accessibilityLabel={`${option.title}. ${option.detail}${selected ? '. Open' : ''}`}
              accessibilityHint={busy !== null && !active ? 'Wait for the current pick to finish' : undefined}
              style={styles.card}
            >
              <View style={{ gap: spacing.sm }}>
                {active ? (
                  <ActivityIndicator color={colors.onAccent} style={styles.icon} />
                ) : (
                  <Icon name={selected ? 'checkmark.circle.fill' : option.icon} fallback={selected ? '✓' : option.fallback} size={28} />
                )}
                <NBText variant="h3">{option.title}</NBText>
                <NBText variant="small" color="muted">
                  {option.detail}
                </NBText>
              </View>
            </Card>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Two columns: (100% - gap) / 2, expressed with flexBasis + grow so Dynamic Type can wrap.
  cell: { flexBasis: '46%', flexGrow: 1 },
  card: { minHeight: 132 },
  icon: { alignSelf: 'flex-start', height: 28 },
});
