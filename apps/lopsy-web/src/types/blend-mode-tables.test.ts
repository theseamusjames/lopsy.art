import { describe, it, expect } from 'vitest';
import {
  BLEND_MODES_BY_PSD_INDEX,
  BLEND_MODE_TO_PSD_INDEX,
  BLEND_MODE_TO_PASCAL,
  BLEND_MODE_TO_DISPLAY,
} from './blend-mode-tables';
import type { BlendMode } from './color';

// All modes that correspond to a Rust/WASM BlendMode discriminant and a PSD index.
// pass-through is intentionally excluded: it is group-only, handled in JS, and
// has no Rust discriminant or PSD file-format index.
const PSD_TAGS: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

// Every mode in the BlendMode union (including pass-through).
const ALL_TAGS: readonly BlendMode[] = [
  ...PSD_TAGS,
  'pass-through',
];

describe('blend-mode-tables', () => {
  it('BLEND_MODES_BY_PSD_INDEX contains every PSD-backed tag exactly once', () => {
    expect(new Set(BLEND_MODES_BY_PSD_INDEX)).toEqual(new Set(PSD_TAGS));
    expect(BLEND_MODES_BY_PSD_INDEX).toHaveLength(PSD_TAGS.length);
  });

  it('pass-through is absent from BLEND_MODES_BY_PSD_INDEX (no PSD discriminant)', () => {
    expect(BLEND_MODES_BY_PSD_INDEX).not.toContain('pass-through');
  });

  it('BLEND_MODE_TO_PSD_INDEX is the inverse of BLEND_MODES_BY_PSD_INDEX', () => {
    for (let i = 0; i < BLEND_MODES_BY_PSD_INDEX.length; i++) {
      const tag = BLEND_MODES_BY_PSD_INDEX[i]!;
      expect(BLEND_MODE_TO_PSD_INDEX[tag]).toBe(i);
    }
  });

  it('pass-through has no PSD index', () => {
    expect(BLEND_MODE_TO_PSD_INDEX['pass-through']).toBeUndefined();
  });

  it('every display table has an entry for every tag including pass-through', () => {
    for (const tag of ALL_TAGS) {
      expect(BLEND_MODE_TO_PASCAL[tag]).toBeTypeOf('string');
      expect(BLEND_MODE_TO_DISPLAY[tag]).toBeTypeOf('string');
    }
  });

  it('pascal names are PascalCase and display names are title-cased', () => {
    for (const tag of PSD_TAGS) {
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

  it('pass-through display name is "Pass Through"', () => {
    expect(BLEND_MODE_TO_DISPLAY['pass-through']).toBe('Pass Through');
  });

  it('canonical PSD order is the 16 modes Photoshop expects (first-level sanity)', () => {
    expect(BLEND_MODES_BY_PSD_INDEX[0]).toBe('normal');
    expect(BLEND_MODES_BY_PSD_INDEX[1]).toBe('multiply');
    expect(BLEND_MODES_BY_PSD_INDEX[15]).toBe('luminosity');
  });
});
