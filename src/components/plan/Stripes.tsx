import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

export interface StripesProps {
  /** Stripe color; defaults to the dark ink used on accent fills (both modes). */
  color?: string;
  opacity?: number;
  /** Distance between stripes. */
  gap?: number;
  /** Corner radius of the surface underneath, so the stripes stay inside its rounded edge. */
  radius?: number;
}

/**
 * Diagonal hazard stripes laid over a red-zone surface (DESIGN.md: red zones are striped so
 * color is never the only signal). Decorative: absolutely fills its parent and ignores touches.
 * Render it as the first child so content draws on top.
 */
export function Stripes({ color, opacity = 0.22, gap = 10, radius = 0 }: StripesProps) {
  const { colors } = useTheme();
  const id = `stripes${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stroke = Math.max(2, Math.round(gap / 3));
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={gap} height={gap} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={stroke} height={gap} fill={color ?? colors.onAccent} fillOpacity={opacity} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
