import { describe, it, expect } from 'vitest';
import {
  styleToWeight,
  isItalicStyle,
  guessLocalFontCategory,
  groupLocalFontFaces,
  mergeLocalFonts,
  type LocalFontFace,
} from './local-fonts';
import { FONT_CATALOG } from './font-catalog';

function face(family: string, style: string): LocalFontFace {
  return { family, style, fullName: `${family} ${style}`, postscriptName: `${family}-${style}`.replace(/\s+/g, '') };
}

describe('styleToWeight', () => {
  it.each([
    ['Regular', 400],
    ['Plain', 400],
    ['Roman', 400],
    ['Book', 400],
    ['Italic', 400],
    ['', 400],
    ['Thin', 100],
    ['Hairline', 100],
    ['UltraLight', 200],
    ['Ultra Light Italic', 200],
    ['ExtraLight', 200],
    ['Light', 300],
    ['Light Oblique', 300],
    ['Condensed Light', 300],
    ['Medium', 500],
    ['Medium Italic', 500],
    ['Semibold', 600],
    ['SemiBold Italic', 600],
    ['Semi Bold', 600],
    ['Demi Bold', 600],
    ['Demi', 600],
    ['Bold', 700],
    ['Bold Italic', 700],
    ['BoldOblique', 700],
    ['Condensed Bold', 700],
    ['ExtraBold', 800],
    ['Condensed ExtraBold', 800],
    ['UltraBold', 800],
    ['Heavy', 900],
    ['Heavy Oblique', 900],
    ['Black', 900],
    ['Condensed Black', 900],
    ['ExtraBlack', 1000],
  ])('maps %j to %i', (style, weight) => {
    expect(styleToWeight(style)).toBe(weight);
  });

  it('reads Hiragino-style numbered weights', () => {
    expect(styleToWeight('W3')).toBe(300);
    expect(styleToWeight('W6')).toBe(600);
    expect(styleToWeight('W0')).toBe(100);
    expect(styleToWeight('W9')).toBe(900);
  });

  it('does not treat a W inside a word as a numbered weight', () => {
    expect(styleToWeight('Wide')).toBe(400);
    expect(styleToWeight('Bw2')).toBe(400);
  });
});

describe('isItalicStyle', () => {
  it('recognises italic, oblique and inclined faces', () => {
    expect(isItalicStyle('Italic')).toBe(true);
    expect(isItalicStyle('Bold Italic')).toBe(true);
    expect(isItalicStyle('Light Oblique')).toBe(true);
    expect(isItalicStyle('Bold Inclined')).toBe(true);
  });

  it('is false for upright faces', () => {
    expect(isItalicStyle('Regular')).toBe(false);
    expect(isItalicStyle('Bold')).toBe(false);
    expect(isItalicStyle('Condensed Black')).toBe(false);
  });
});

describe('guessLocalFontCategory', () => {
  it('spots monospace, handwriting and serif families by name', () => {
    expect(guessLocalFontCategory('Menlo')).toBe('monospace');
    expect(guessLocalFontCategory('Courier New')).toBe('monospace');
    expect(guessLocalFontCategory('Source Code Pro')).toBe('monospace');
    expect(guessLocalFontCategory('Brush Script MT')).toBe('handwriting');
    expect(guessLocalFontCategory('Chalkboard')).toBe('handwriting');
    expect(guessLocalFontCategory('Times New Roman')).toBe('serif');
    expect(guessLocalFontCategory('Hoefler Text')).toBe('serif');
    expect(guessLocalFontCategory('Noto Serif')).toBe('serif');
  });

  it('keeps sans-serif families out of the serif bucket and defaults to sans-serif', () => {
    expect(guessLocalFontCategory('Noto Sans Serif Display')).toBe('sans-serif');
    expect(guessLocalFontCategory('Avenida Std')).toBe('sans-serif');
    expect(guessLocalFontCategory('Helvetica Neue')).toBe('sans-serif');
  });
});

describe('groupLocalFontFaces', () => {
  it('collapses faces into one entry per family with sorted unique weights', () => {
    const entries = groupLocalFontFaces([
      face('Helvetica Neue', 'Bold'),
      face('Helvetica Neue', 'Regular'),
      face('Helvetica Neue', 'Condensed Bold'),
      face('Helvetica Neue', 'Light'),
      face('Helvetica Neue', 'UltraLight'),
      face('Helvetica Neue', 'Italic'),
    ]);
    expect(entries).toHaveLength(1);
    const [helvetica] = entries;
    expect(helvetica!.family).toBe('Helvetica Neue');
    expect(helvetica!.weights).toEqual([200, 300, 400, 700]);
    expect(helvetica!.hasItalic).toBe(true);
    expect(helvetica!.source).toBe('local');
  });

  it('marks single-upright-face families as non-italic', () => {
    const [avenida] = groupLocalFontFaces([face('Avenida Std', 'Regular')]);
    expect(avenida!.weights).toEqual([400]);
    expect(avenida!.hasItalic).toBe(false);
  });

  it('sorts families alphabetically regardless of input order', () => {
    const entries = groupLocalFontFaces([
      face('Zapfino', 'Regular'),
      face('Avenida Std', 'Regular'),
      face('Menlo', 'Regular'),
    ]);
    expect(entries.map((e) => e.family)).toEqual(['Avenida Std', 'Menlo', 'Zapfino']);
  });

  it('drops macOS-internal dot-prefixed families and blank names', () => {
    const entries = groupLocalFontFaces([
      face('.SF NS', 'Regular'),
      face('.AppleSystemUIFont', 'Regular'),
      face('   ', 'Regular'),
      face('Avenida Std', 'Regular'),
    ]);
    expect(entries.map((e) => e.family)).toEqual(['Avenida Std']);
  });

  it('carries the catalog-shaped null fields so consumers can treat local and Google entries alike', () => {
    const [entry] = groupLocalFontFaces([face('Avenida Std', 'Regular')]);
    expect(entry).toMatchObject({ previewFile: null, ttfDir: null, ttfFile: null, ttfWeightFiles: null });
  });
});

describe('mergeLocalFonts', () => {
  it('returns the catalog untouched when nothing is installed', () => {
    expect(mergeLocalFonts(FONT_CATALOG, [])).toBe(FONT_CATALOG);
  });

  it('puts local families first and drops catalog rows they shadow', () => {
    const local = groupLocalFontFaces([face('Arial', 'Regular'), face('Avenida Std', 'Regular')]);
    const merged = mergeLocalFonts(FONT_CATALOG, local);
    expect(merged.slice(0, 2).map((e) => e.family)).toEqual(['Arial', 'Avenida Std']);
    expect(merged.filter((e) => e.family === 'Arial')).toHaveLength(1);
    expect(merged.find((e) => e.family === 'Arial')?.source).toBe('local');
    expect(merged).toHaveLength(FONT_CATALOG.length + 1);
  });
});
