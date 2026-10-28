import { createContext, use, type ReactNode } from 'react';

import { useTheme } from '@/theme';

import type { InkColors } from './inkForFill';

export { inkForFill, type InkColors } from './inkForFill';

const InkContext = createContext<InkColors | null>(null);

export function InkProvider({ value, children }: { value: InkColors; children: ReactNode }) {
  return <InkContext value={value}>{children}</InkContext>;
}

export function useInk(): InkColors {
  const { colors } = useTheme();
  return use(InkContext) ?? { ink: colors.ink, muted: colors.inkMuted };
}
