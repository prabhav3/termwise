import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black/400Regular';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import type { TextStyle } from 'react-native';

/** Family names = the keys passed to useFonts(). Custom families carry their weight, so never set fontWeight. */
export const fonts = {
  display: 'ArchivoBlack_400Regular',
  body: 'SpaceGrotesk_400Regular',
  bodyMedium: 'SpaceGrotesk_500Medium',
  bodyBold: 'SpaceGrotesk_700Bold',
} as const;

/** Passed to expo-font's useFonts() in the root layout. Per-weight imports keep unused weights out of the bundle. */
export const fontAssets = {
  [fonts.display]: ArchivoBlack_400Regular,
  [fonts.body]: SpaceGrotesk_400Regular,
  [fonts.bodyMedium]: SpaceGrotesk_500Medium,
  [fonts.bodyBold]: SpaceGrotesk_700Bold,
};

export type TypeVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyMedium'
  | 'bodyBold'
  | 'small'
  | 'smallBold'
  | 'tiny'
  | 'label'
  | 'number';

type TypeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'textTransform'>;

/** Size / line-height scale from docs/DESIGN.md. */
export const typeScale: Record<TypeVariant, TypeStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  h1: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26 },
  h3: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22 },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  smallBold: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20 },
  tiny: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  /** Small uppercase labels above fields and sections. */
  label: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.8, textTransform: 'uppercase' },
  /** Numbers that matter (stress score, grade %, minutes). */
  number: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
};

export const HEADING_VARIANTS: ReadonlySet<TypeVariant> = new Set(['display', 'h1', 'h2', 'h3']);
