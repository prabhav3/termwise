import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { InkProvider, inkForFill } from './ink';
import { NBText } from './NBText';

export interface WordmarkProps {
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

/** The TERMWISE stamp: a tilted yellow block with a pink tab behind it. */
export function Wordmark({ size = 'md', style }: WordmarkProps) {
  const theme = useTheme();
  const { colors, borders, spacing } = theme;
  const large = size === 'lg';

  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Termwise" style={[styles.root, style]}>
      <View
        style={[
          styles.tab,
          {
            backgroundColor: colors.pink,
            borderColor: colors.border,
            borderWidth: borders.standard,
            width: large ? 40 : 30,
            height: large ? 40 : 30,
          },
        ]}
      />
      <InkProvider value={inkForFill('accent', colors)}>
        <View
          style={[
            {
              backgroundColor: colors.yellow,
              borderColor: colors.border,
              borderWidth: borders.standard,
              paddingHorizontal: large ? spacing.lg : spacing.md,
              paddingVertical: large ? spacing.sm : spacing.xs,
              transform: [{ rotate: '-2deg' }],
            },
            theme.shadow(large ? 'lg' : 'md'),
          ]}
        >
          <NBText variant={large ? 'h1' : 'h3'} accessible={false} maxFontSizeMultiplier={1.2}>
            TERMWISE
          </NBText>
        </View>
      </InkProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start', paddingTop: 10, paddingLeft: 10 },
  tab: { position: 'absolute', top: 0, left: 0, transform: [{ rotate: '8deg' }] },
});
