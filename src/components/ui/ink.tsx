import { createContext, use, type ReactNode } from 'react';

import { useTheme, type ColorTokens } from '@/theme';

/**
 * Default text colors for whatever surface a piece of text sits on. Accent and primary fills
 * set this so NBText inside them reads correctly in both modes without every caller passing colors.
 */
export interface InkColors {
  ink: string;
  muted: string;
}

const InkContext = createContext<InkColors | null>(null);

export function InkProvider({ value, children }: { value: InkColors; children: ReactNode }) {
  return <InkContext value={value}>{children}</InkContext>;
}

export function useInk(): InkColors {
  const { colors } = useTheme();
  return use(InkContext) ?? { ink: colors.ink, muted: colors.inkMuted };
}

/** Ink for text on a fill: dark ink on accents, onPrimary on primary, theme ink elsewhere. */
export function inkForFill(fill: 'accent' | 'primary' | 'ink' | 'surface', colors: ColorTokens): InkColors {
  switch (fill) {
    case 'accent':
      return { ink: colors.onAccent, muted: 'rgba(17, 17, 17, 0.72)' };
    case 'primary':
      return { ink: colors.onPrimary, muted: colors.onPrimary };
    case 'ink':
      return { ink: colors.inkInverse, muted: colors.inkInverse };
    case 'surface':
      return { ink: colors.ink, muted: colors.inkMuted };
  }
}
