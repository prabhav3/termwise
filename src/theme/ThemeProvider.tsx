import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme, type ViewStyle } from 'react-native';

import type { StressLevel } from '@/engine/types';
import { readString, storageKeys, writeString } from '@/lib/storage';

import {
  borders,
  courseColors,
  MIN_TOUCH,
  motion,
  palettes,
  radius,
  shadowOffsets,
  spacing,
  type ColorScheme,
  type ColorTokens,
  type ShadowSize,
} from './tokens';
import { fonts, typeScale } from './typography';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  borders: typeof borders;
  motion: typeof motion;
  shadowOffsets: typeof shadowOffsets;
  /** Hard offset shadow (no blur) as an RN `boxShadow` style. */
  shadow: (size?: ShadowSize) => Pick<ViewStyle, 'boxShadow'>;
  type: typeof typeScale;
  fonts: typeof fonts;
  courseColors: typeof courseColors;
  /** calm = green, busy = yellow, heavy = orange, red = red. */
  stressColors: Record<StressLevel, string>;
  minTouch: number;
}

interface ThemeModeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** The scheme actually in use after applying the preference. */
  scheme: ColorScheme;
  /** True once the saved preference has been read (keeps the splash up until then). */
  ready: boolean;
}

export function buildTheme(scheme: ColorScheme): Theme {
  const colors = palettes[scheme];
  return {
    scheme,
    colors,
    spacing,
    radius,
    borders,
    motion,
    shadowOffsets,
    shadow: (size = 'md') => {
      const offset = shadowOffsets[size];
      return { boxShadow: `${offset}px ${offset}px 0px 0px ${colors.shadow}` };
    },
    type: typeScale,
    fonts,
    courseColors,
    stressColors: { calm: colors.green, busy: colors.yellow, heavy: colors.orange, red: colors.red },
    minTouch: MIN_TOUCH,
  };
}

const themes: Record<ColorScheme, Theme> = { light: buildTheme('light'), dark: buildTheme('dark') };

const ThemeContext = createContext<Theme | null>(null);
const ThemeModeContext = createContext<ThemeModeValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Native views (pickers, alerts, tab bar, keyboard) follow the in-app override too. */
function applyAppearance(mode: ThemeMode) {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch {
    // Not supported on this platform (e.g. some web targets); JS theming still applies.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let active = true;
    void readString(storageKeys.themeMode).then((saved) => {
      if (!active) return;
      if (isThemeMode(saved)) setModeState(saved);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyAppearance(mode);
  }, [mode]);

  const scheme: ColorScheme = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const theme = themes[scheme];

  const modeValue = useMemo<ThemeModeValue>(
    () => ({
      mode,
      scheme,
      ready,
      setMode: (next) => {
        setModeState(next);
        void writeString(storageKeys.themeMode, next);
      },
    }),
    [mode, scheme, ready],
  );

  return (
    <ThemeModeContext value={modeValue}>
      <ThemeContext value={theme}>{children}</ThemeContext>
    </ThemeModeContext>
  );
}

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('useTheme() must be used inside <ThemeProvider>.');
  return theme;
}

export function useThemeMode(): ThemeModeValue {
  const value = use(ThemeModeContext);
  if (!value) throw new Error('useThemeMode() must be used inside <ThemeProvider>.');
  return value;
}
