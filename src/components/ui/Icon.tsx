import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Text, type ColorValue } from 'react-native';

import { useInk } from './ink';

export type SymbolName = Extract<SymbolViewProps['name'], string>;

export interface IconProps {
  /** SF Symbol name (iOS). */
  name: SymbolName;
  /** Text glyph shown where SF Symbols are unavailable. */
  fallback: string;
  size?: number;
  color?: ColorValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
}

/** Decorative icon; the pressable that contains it carries the accessibility label. */
export function Icon({ name, fallback, size = 20, color, weight = 'bold' }: IconProps) {
  const ink = useInk();
  const tint = color ?? ink.ink;
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={tint}
      weight={weight}
      accessible={false}
      importantForAccessibility="no"
      style={{ width: size, height: size }}
      fallback={
        <Text
          accessible={false}
          allowFontScaling={false}
          style={{ color: tint, fontSize: size * 0.8, lineHeight: size, width: size, textAlign: 'center' }}
        >
          {fallback}
        </Text>
      }
    />
  );
}
