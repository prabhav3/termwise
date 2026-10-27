import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme, type ColorTokens, type TypeVariant } from '@/theme';
import { HEADING_VARIANTS } from '@/theme/typography';

import { useInk } from './ink';

export interface NBTextProps extends TextProps {
  variant?: TypeVariant;
  /** A theme color token; defaults to the ink of the surface the text sits on. `muted` = secondary text. */
  color?: keyof ColorTokens | 'muted';
  align?: TextStyle['textAlign'];
  /** Caps Dynamic Type growth on dense rows (DESIGN.md: 1.4). */
  dense?: boolean;
}

export function NBText({ variant = 'body', color, align, dense, style, accessibilityRole, ...rest }: NBTextProps) {
  const { colors, type } = useTheme();
  const ink = useInk();
  const resolved = color === undefined ? ink.ink : color === 'muted' ? ink.muted : colors[color];
  return (
    <Text
      accessibilityRole={accessibilityRole ?? (HEADING_VARIANTS.has(variant) ? 'header' : undefined)}
      maxFontSizeMultiplier={dense ? 1.4 : rest.maxFontSizeMultiplier}
      style={[type[variant], { color: resolved }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
