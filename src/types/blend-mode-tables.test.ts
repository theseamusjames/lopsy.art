import { describe, it, expect } from 'vitest';
import {
  BLEND_MODES_BY_PSD_INDEX,
  BLEND_MODE_TO_PSD_INDEX,
  BLEND_MODE_TO_PASCAL,
  BLEND_MODE_TO_DISPLAY,
} from './blend-mode-tables';
import type { BlendMode } from './color';

// The TS union in ./color.ts. If this array drifts from the union, the
// Record<BlendMode, _> tables below stop compiling.
const UNION_TAGS: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

describe('blend-mode-tables', () => {
  it('BLEND_MODES_BY_PSD_INDEX contains every tag in the union exactly once', () => {
    expect(new Set(BLEND_MODES_BY_PSD_INDEX)).toEqual(new Set(UNION_TAGS));
    expect(BLEND_MODES_BY_PSD_INDEX).toHaveLength(UNION_TAGS.length);
  });

  it('BLEND_MODE_TO_PSD_INDEX is the inverse of BLEND_MODES_BY_PSD_INDEX', () => {
    for (let i = 0; i < BLEND_MODES_BY_PSD_INDEX.length; i++) {
      const tag = BLEND_MODES_BY_PSD_INDEX[i]!;
      expect(BLEND_MODE_TO_PSD_INDEX[tag]).toBe(i);
    }
  });

  it('every table has an entry for every tag', () => {
    for (const tag of UNION_TAGS) {
      expect(BLEND_MODE_TO_PSD_INDEX[tag]).toBeTypeOf('number');
      expect(BLEND_MODE_TO_PASCAL[tag]).toBeTypeOf('string');
      expect(BLEND_MODE_TO_DISPLAY[tag]).toBeTypeOf('string');
    }
  });

  it('pascal names are PascalCase and display names are title-cased', () => {
    for (const tag of UNION_TAGS) {
      const pascal = BLEND_MODE_TO_PASCAL[tag];
      expect(pascal[0]).toBe(pascal[0]?.toUpperCase());
      expect(pascal).not.toContain('-');
      expect(pascal).not.toContain(' ');

      const display = BLEND_MODE_TO_DISPLAY[tag];
      expect(display[0]).toBe(display[0]?.toUpperCase());
      // Display names may contain spaces (Color Dodge, Hard Light) but no
      // kebab hyphens.
      expect(display).not.toContain('-');
    }
  });

  it('canonical PSD order is the 16 modes Photoshop expects (first-level sanity)', () => {
    expect(BLEND_MODES_BY_PSD_INDEX[0]).toBe('normal');
    expect(BLEND_MODES_BY_PSD_INDEX[1]).toBe('multiply');
    expect(BLEND_MODES_BY_PSD_INDEX[15]).toBe('luminosity');
  });
});
