// DESIGN.md: text contrast >= 4.5:1 (WCAG AA, normal-size text) in both modes.
import { describe, expect, it } from 'vitest';

import { courseColors, palettes, type AccentColor, type ColorScheme } from '@/theme/tokens';

import { inkForFill } from './inkForFill';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(foreground: string, background: string): number {
  expect(foreground, 'solid hex colors only (alpha would need blending)').toMatch(/^#[0-9A-Fa-f]{6}$/);
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SCHEMES: ColorScheme[] = ['light', 'dark'];
const ACCENTS: AccentColor[] = ['yellow', 'pink', 'blue', 'green', 'orange', 'red', 'purple'];

describe('text contrast', () => {
  it('reads text and secondary text on every accent fill and course color', () => {
    for (const scheme of SCHEMES) {
      const colors = palettes[scheme];
      const ink = inkForFill('accent', colors);
      for (const fill of [...ACCENTS.map((accent) => colors[accent]), ...courseColors]) {
        expect(contrast(ink.ink, fill), `${scheme} ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(ink.muted, fill), `${scheme} muted on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reads error and destructive text (danger) on every surface', () => {
    for (const scheme of SCHEMES) {
      const colors = palettes[scheme];
      for (const surface of [colors.bg, colors.surface, colors.surfaceAlt]) {
        expect(contrast(colors.danger, surface), `${scheme} danger on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reads body and muted text on bg and surface', () => {
    for (const scheme of SCHEMES) {
      const colors = palettes[scheme];
      for (const surface of [colors.bg, colors.surface]) {
        expect(contrast(colors.ink, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.inkMuted, surface), `${scheme} muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
