import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type AccentColor, type ShadowSize } from '@/theme';

import { resolveFill } from './fills';
import { InkProvider, inkForFill } from './ink';
import { PressableSurface } from './PressableSurface';

export interface CardProps {
  children?: ReactNode;
  /** Flat accent fill (text switches to dark ink), or a course hex color. Defaults to `surface`. */
  color?: AccentColor | 'surfaceAlt' | (string & {});
  shadow?: ShadowSize | 'none';
  /** Makes the whole card pressable with the press-in-shadow motion. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  color,
  shadow = 'md',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
  style,
  testID,
}: CardProps) {
  const theme = useTheme();
  const { colors, radius, borders, spacing } = theme;
  const isAccent = color !== undefined && color !== 'surfaceAlt';
  const background =
    color === undefined ? colors.surface : color === 'surfaceAlt' ? colors.surfaceAlt : resolveFill(color, colors);

  const base: ViewStyle = {
    backgroundColor: background,
    borderColor: colors.border,
    borderWidth: borders.standard,
    borderRadius: radius.card,
    padding: padded ? spacing.lg : 0,
  };
  const ink = inkForFill(isAccent ? 'accent' : 'surface', colors);

  if (onPress) {
    return (
      <InkProvider value={ink}>
        <PressableSurface
          shadow={shadow}
          onPress={onPress}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          testID={testID}
          style={[base, style]}
        >
          {children}
        </PressableSurface>
      </InkProvider>
    );
  }

  return (
    <InkProvider value={ink}>
      <View
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[base, shadow === 'none' ? null : theme.shadow(shadow), style]}
      >
        {children}
      </View>
    </InkProvider>
  );
}
