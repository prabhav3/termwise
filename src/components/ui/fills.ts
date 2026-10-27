import type { AccentColor, ColorTokens } from '@/theme';

const ACCENTS: ReadonlySet<string> = new Set<AccentColor>(['yellow', 'pink', 'blue', 'green', 'orange', 'red', 'purple']);

export function isAccentToken(value: string): value is AccentColor {
  return ACCENTS.has(value);
}

/** An accent token resolves through the active palette; anything else (a course hex) is used as-is. */
export function resolveFill(color: AccentColor | (string & {}), colors: ColorTokens): string {
  return isAccentToken(color) ? colors[color] : color;
}
