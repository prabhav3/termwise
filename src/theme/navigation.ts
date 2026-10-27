import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from 'expo-router';

import type { Theme } from './ThemeProvider';

/** Navigation container theme built from our tokens (prevents white flashes behind screens in dark mode). */
export function navigationTheme(theme: Theme): NavigationTheme {
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const { colors, fonts } = theme;
  return {
    ...base,
    dark: theme.scheme === 'dark',
    colors: {
      primary: colors.primary,
      background: colors.bg,
      card: colors.bg,
      text: colors.ink,
      border: colors.border,
      notification: colors.red,
    },
    fonts: {
      regular: { fontFamily: fonts.body, fontWeight: 'normal' },
      medium: { fontFamily: fonts.bodyMedium, fontWeight: 'normal' },
      bold: { fontFamily: fonts.bodyBold, fontWeight: 'normal' },
      heavy: { fontFamily: fonts.display, fontWeight: 'normal' },
    },
  };
}
