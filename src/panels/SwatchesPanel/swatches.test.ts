import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWATCHES,
  MAX_SWATCHES,
  addSwatches,
  parseGpl,
  removeSwatchAt,
  sanitizeSwatches,
  serializeGpl,
  sortColorsForPalette,
  swatchLabel,
} from './swatches';
import type { Swatch } from './swatches';

const red: Swatch = { color: { r: 255, g: 0, b: 0, a: 1 }, name: 'Red' };
const green: Swatch = { color: { r: 0, g: 255, b: 0, a: 1 }, name: '' };

describe('addSwatches', () => {
  it('appends new colors in order', () => {
    expect(addSwatches([red], [green])).toEqual([red, green]);
  });

  it('skips exact duplicates already in the list and within the batch', () => {
    const dupe = { ...red, name: 'Other name' };
    expect(addSwatches([red], [dupe, green, green])).toEqual([red, green]);
  });

  it('treats a different alpha as a different swatch', () => {
    const translucent = { color: { ...red.color, a: 0.5 }, name: '' };
    expect(addSwatches([red], [translucent])).toHaveLength(2);
  });

  it('returns the same array when nothing is added', () => {
    const list = [red];
    expect(addSwatches(list, [red])).toBe(list);
  });

  it('stops at MAX_SWATCHES', () => {
    const many = Array.from({ length: MAX_SWATCHES + 10 }, (_, i) => ({
      color: { r: i % 256, g: Math.floor(i / 256), b: 0, a: 1 },
      name: '',
    }));
    expect(addSwatches([], many)).toHaveLength(MAX_SWATCHES);
  });
});

describe('removeSwatchAt', () => {
  it('removes the entry at the index', () => {
    expect(removeSwatchAt([red, green], 0)).toEqual([green]);
  });

  it('ignores an out-of-range index', () => {
    const list = [red];
    expect(removeSwatchAt(list, 3)).toBe(list);
  });
});

describe('sortColorsForPalette', () => {
  it('puts neutrals first, dark to light, then hues around the wheel', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const blue = { r: 0, g: 0, b: 255, a: 1 };
    const redC = { r: 255, g: 0, b: 0, a: 1 };
    const greenC = { r: 0, g: 200, b: 0, a: 1 };
    expect(sortColorsForPalette([blue, white, greenC, redC, black])).toEqual([
      black, white, redC, greenC, blue,
    ]);
  });

  it('orders colors within one hue bucket by lightness', () => {
    const lightRed = { r: 255, g: 150, b: 150, a: 1 };
    const darkRed = { r: 120, g: 10, b: 10, a: 1 };
    expect(sortColorsForPalette([lightRed, darkRed])).toEqual([darkRed, lightRed]);
  });
});

describe('GIMP palette I/O', () => {
  it('round-trips names and colors', () => {
    const text = serializeGpl([red, green], 'Test');
    const parsed = parseGpl(text);
    expect(parsed.name).toBe('Test');
    expect(parsed.swatches[0]).toEqual(red);
    // Unnamed swatches are written with their hex as the name.
    expect(parsed.swatches[1]).toEqual({ color: green.color, name: '#00ff00' });
  });

  it('parses comments, extra headers and untitled entries', () => {
    const parsed = parseGpl(
      'GIMP Palette\nName: Sunset\nColumns: 4\n# comment\n255 128   0\tTangerine\n  10  20  30 Untitled\n',
    );
    expect(parsed.name).toBe('Sunset');
    expect(parsed.swatches).toEqual([
      { color: { r: 255, g: 128, b: 0, a: 1 }, name: 'Tangerine' },
      { color: { r: 10, g: 20, b: 30, a: 1 }, name: '' },
    ]);
  });

  it('clamps out-of-range channels', () => {
    const parsed = parseGpl('GIMP Palette\n300 0 999\n');
    expect(parsed.swatches[0]!.color).toEqual({ r: 255, g: 0, b: 255, a: 1 });
  });

  it('rejects a file without the header', () => {
    expect(() => parseGpl('255 0 0 red')).toThrow(/GIMP Palette/);
  });

  it('rejects a palette with no colors', () => {
    expect(() => parseGpl('GIMP Palette\nName: Empty\n')).toThrow(/no colors/);
  });
});

describe('sanitizeSwatches', () => {
  it('returns null for a non-array payload', () => {
    expect(sanitizeSwatches({ swatches: [] })).toBeNull();
  });

  it('drops malformed entries and duplicates', () => {
    const result = sanitizeSwatches([
      red,
      { color: { r: 300, g: 0, b: 0, a: 1 }, name: 'bad' },
      { color: 'red' },
      null,
      red,
      { color: { r: 1, g: 2, b: 3 } },
    ]);
    expect(result).toEqual([red, { color: { r: 1, g: 2, b: 3, a: 1 }, name: '' }]);
  });

  it('accepts the default palette unchanged', () => {
    expect(sanitizeSwatches(DEFAULT_SWATCHES)).toEqual(DEFAULT_SWATCHES);
  });
});

describe('swatchLabel', () => {
  it('includes the name when present', () => {
    expect(swatchLabel(red)).toBe('Red (#ff0000)');
    expect(swatchLabel(green)).toBe('#00ff00');
  });
});
