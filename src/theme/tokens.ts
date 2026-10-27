// Design tokens from docs/DESIGN.md. Screens read these through useTheme(); never import a
// palette directly into a screen.

export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  inkInverse: string;
  border: string;
  shadow: string;
  primary: string;
  onPrimary: string;
  /** Text on accent fills (yellow, pink, ...). Dark ink in both modes, per DESIGN.md. */
  onAccent: string;
  yellow: string;
  pink: string;
  blue: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  /** Dimmed backdrop behind sheets and modals. */
  scrim: string;
}

export type AccentColor = 'yellow' | 'pink' | 'blue' | 'green' | 'orange' | 'red' | 'purple';

const ACCENT_INK = '#111111';

export const palettes: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: '#FFF4DE',
    surface: '#FFFFFF',
    surfaceAlt: '#FFE9B8',
    ink: '#111111',
    inkMuted: '#4A4A4A',
    inkInverse: '#FFFFFF',
    border: '#111111',
    shadow: '#111111',
    primary: '#5B5BD6',
    onPrimary: '#FFFFFF',
    onAccent: ACCENT_INK,
    yellow: '#FFD23F',
    pink: '#FF6B9D',
    blue: '#4D96FF',
    green: '#3DDC97',
    orange: '#FF8A3D',
    red: '#FF4747',
    purple: '#9B5DE5',
    scrim: 'rgba(17, 17, 17, 0.45)',
  },
  dark: {
    bg: '#141414',
    surface: '#1F1F1F',
    surfaceAlt: '#2A2A2A',
    ink: '#F4F1EA',
    inkMuted: '#B9B4A9',
    inkInverse: '#111111',
    border: '#F4F1EA',
    shadow: '#000000',
    primary: '#8B8BFF',
    onPrimary: '#111111',
    onAccent: ACCENT_INK,
    yellow: '#FFD23F',
    pink: '#FF7EAA',
    blue: '#6AA8FF',
    green: '#46E3A0',
    orange: '#FF9A55',
    red: '#FF5C5C',
    purple: '#B07CFF',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
};

/** 4-pt grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  /** Screen side gutters. */
  gutter: 16,
} as const;

export const radius = {
  /** Tags and date stamps. */
  none: 0,
  /** Buttons and inputs. */
  control: 8,
  card: 12,
  pill: 999,
} as const;

export const borders = {
  /** Dividers, chips. */
  hairline: 2,
  /** Cards, buttons, inputs. */
  standard: 3,
} as const;

export type ShadowSize = 'sm' | 'md' | 'lg';

/** Hard shadow offsets (x = y, no blur). */
export const shadowOffsets: Record<ShadowSize, number> = { sm: 2, md: 4, lg: 6 };

export const motion = {
  pressMs: 120,
  enterMs: 180,
} as const;

/** Minimum touch target (Apple HIG / DESIGN.md). */
export const MIN_TOUCH = 44;

/**
 * Course colors, assigned in order when a course is created. Stored on the course row as hex,
 * so they use the light-mode accent values and stay identical across modes.
 */
export const courseColors = [
  palettes.light.blue,
  palettes.light.pink,
  palettes.light.yellow,
  palettes.light.green,
  palettes.light.orange,
  palettes.light.purple,
  '#00C2C7',
  '#C6F432',
] as const;

/** The next course color for a student who already has `existingCount` courses. */
export function nextCourseColor(existingCount: number): string {
  const index = ((existingCount % courseColors.length) + courseColors.length) % courseColors.length;
  return courseColors[index];
}
