// The number that matters: a big Archivo Black percent next to a stamped letter block.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { InkProvider, inkForFill, NBText } from '@/components/ui';
import { useTheme } from '@/theme';

import { formatGrade } from './model';

export interface GradeHeadlineProps {
  percent: number | null;
  letter: string | null;
  /** Small uppercase line above the number, e.g. "Current grade". */
  caption: string;
  /** Fill behind the letter (a course hex color or accent value). */
  letterColor: string;
  /** "hero" doubles the number for the detail screen. */
  size?: 'regular' | 'hero';
  /** Extra line under the number, e.g. "+2.1 vs now". */
  note?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function GradeHeadline({ percent, letter, caption, letterColor, size = 'regular', note, style }: GradeHeadlineProps) {
  const theme = useTheme();
  const { colors, borders, spacing, type } = theme;
  const hero = size === 'hero';
  const numberStyle = hero
    ? { fontSize: (type.number.fontSize ?? 34) * 1.5, lineHeight: (type.number.lineHeight ?? 38) * 1.45 }
    : null;
  const block = hero ? 72 : 56;
  const spokenPercent = percent === null ? 'no score yet' : formatGrade(percent).replace('%', ' percent');

  return (
    <View
      accessible
      accessibilityLabel={`${caption}: ${spokenPercent}${letter ? `, ${letter}` : ''}${note ? `. ${note}` : ''}`}
      style={[styles.row, { gap: spacing.md }, style]}
    >
      <View style={styles.text}>
        <NBText variant="label" color="muted">
          {caption}
        </NBText>
        <NBText variant="number" style={numberStyle} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
          {formatGrade(percent)}
        </NBText>
        {note ? (
          <NBText variant="smallBold" color="muted" dense>
            {note}
          </NBText>
        ) : null}
      </View>
      {letter ? (
        <InkProvider value={inkForFill('accent', colors)}>
          <View
            style={[
              styles.letter,
              {
                minWidth: block,
                height: block,
                paddingHorizontal: spacing.sm,
                backgroundColor: letterColor,
                borderColor: colors.border,
                borderWidth: borders.standard,
              },
              theme.shadow('sm'),
            ]}
          >
            <NBText variant={hero ? 'h1' : 'h2'} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
              {letter}
            </NBText>
          </View>
        </InkProvider>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
  letter: { alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
});
