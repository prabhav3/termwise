// Pure part of ink.tsx (no React), so the contrast rules can be unit-tested.
import type { ColorTokens } from '@/theme/tokens';

/**
 * Default text colors for whatever surface a piece of text sits on. Accent and primary fills
 * set this so NBText inside them reads correctly in both modes without every caller passing colors.
 */
export interface InkColors {
  ink: string;
  muted: string;
}

/** Ink for text on a fill: dark ink on accents, onPrimary on primary, theme ink elsewhere. */
export function inkForFill(fill: 'accent' | 'primary' | 'ink' | 'surface', colors: ColorTokens): InkColors {
  switch (fill) {
    case 'accent':
      // Secondary text on accents stays solid ink: even 85% ink drops below 4.5:1 on purple
      // (#111 itself is 4.58:1 there). Size and weight set it apart instead.
      return { ink: colors.onAccent, muted: colors.onAccent };
    case 'primary':
      return { ink: colors.onPrimary, muted: colors.onPrimary };
    case 'ink':
      return { ink: colors.inkInverse, muted: colors.inkInverse };
    case 'surface':
      return { ink: colors.ink, muted: colors.inkMuted };
  }
}
