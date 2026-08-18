import { describe, it, expect } from 'vitest';
import {
  buildCss2StylesheetUrl,
  buildCss2SingleWeightUrl,
  buildCss2PreviewUrl,
  extractFirstFontUrl,
  extractFontUrlPreferLatin,
} from './font-urls';

function fontFaceBlock(subset: string | null, url: string, unicodeRange: string): string {
  const comment = subset === null ? '' : `/* ${subset} */\n`;
  return `${comment}@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${url}) format('woff2');
  unicode-range: ${unicodeRange};
}`;
}

// Mirrors real css2 responses: non-latin subsets listed before latin.
const MULTI_SUBSET_CSS = [
  fontFaceBlock('cyrillic-ext', 'https://fonts.gstatic.com/s/roboto/v49/cyr-ext.woff2', 'U+0460-052F'),
  fontFaceBlock('cyrillic', 'https://fonts.gstatic.com/s/roboto/v49/cyr.woff2', 'U+0301, U+0400-045F'),
  fontFaceBlock('greek', 'https://fonts.gstatic.com/s/roboto/v49/greek.woff2', 'U+0370-0377'),
  fontFaceBlock('latin-ext', 'https://fonts.gstatic.com/s/roboto/v49/latin-ext.woff2', 'U+0100-02BA'),
  fontFaceBlock('latin', 'https://fonts.gstatic.com/s/roboto/v49/latin.woff2', 'U+0000-00FF'),
].join('\n');

describe('buildCss2StylesheetUrl', () => {
  it('joins all weights with semicolons and URL-encodes the family', () => {
    expect(buildCss2StylesheetUrl('Anton SC', [400])).toBe(
      'https://fonts.googleapis.com/css2?family=Anton%20SC:wght@400&display=swap',
    );
    expect(buildCss2StylesheetUrl('Roboto', [100, 400, 700])).toBe(
      'https://fonts.googleapis.com/css2?family=Roboto:wght@100;400;700&display=swap',
    );
  });
});

describe('buildCss2SingleWeightUrl', () => {
  it('requests exactly one weight', () => {
    expect(buildCss2SingleWeightUrl('Open Sans', 300)).toBe(
      'https://fonts.googleapis.com/css2?family=Open%20Sans:wght@300&display=swap',
    );
  });
});

describe('buildCss2PreviewUrl', () => {
  // Regression for #729: the picker used to fetch pre-rendered PNGs from a
  // third-party CDN that has since been deleted (getstencil/
  // GoogleWebFonts-FontFamilyPreviewImages 404s), so no row showed a preview.
  // The css2 `text=` param returns a subset of the family covering just the
  // requested glyphs, so each row can render its name in its own face.
  it('subsets the family to the requested preview text', () => {
    expect(buildCss2PreviewUrl('Inter', 'Inter')).toBe(
      'https://fonts.googleapis.com/css2?family=Inter&text=Inter&display=swap',
    );
  });

  it('URL-encodes both the family and the preview text', () => {
    expect(buildCss2PreviewUrl('Open Sans', 'Open Sans')).toBe(
      'https://fonts.googleapis.com/css2?family=Open%20Sans&text=Open%20Sans&display=swap',
    );
  });

  it('does not embed the deleted getstencil CDN path', () => {
    expect(buildCss2PreviewUrl('Inter', 'Inter')).not.toContain('getstencil');
    expect(buildCss2PreviewUrl('Inter', 'Inter')).not.toContain(
      'GoogleWebFonts-FontFamilyPreviewImages',
    );
  });
});

describe('extractFirstFontUrl', () => {
  it('returns the first url() and strips quotes', () => {
    expect(extractFirstFontUrl("src: url('https://x/a.woff2') format('woff2');")).toBe(
      'https://x/a.woff2',
    );
  });

  it('returns null when no url() is present', () => {
    expect(extractFirstFontUrl('body { color: red; }')).toBeNull();
  });
});

describe('extractFontUrlPreferLatin', () => {
  it('picks the latin block even when non-latin subsets come first', () => {
    expect(extractFontUrlPreferLatin(MULTI_SUBSET_CSS)).toBe(
      'https://fonts.gstatic.com/s/roboto/v49/latin.woff2',
    );
  });

  it('falls back to latin-ext when there is no latin block', () => {
    const css = [
      fontFaceBlock('hebrew', 'https://x/hebrew.woff2', 'U+0590-05FF'),
      fontFaceBlock('latin-ext', 'https://x/latin-ext.woff2', 'U+0100-02BA'),
    ].join('\n');
    expect(extractFontUrlPreferLatin(css)).toBe('https://x/latin-ext.woff2');
  });

  it('falls back to the first url() when no labelled latin block exists', () => {
    const css = [
      fontFaceBlock('[3]', 'https://x/slice3.woff2', 'U+2E80-2EFF'),
      fontFaceBlock('[4]', 'https://x/slice4.woff2', 'U+3000-303F'),
    ].join('\n');
    expect(extractFontUrlPreferLatin(css)).toBe('https://x/slice3.woff2');
  });

  it('handles a single unlabelled block', () => {
    const css = fontFaceBlock(null, 'https://x/only.woff2', 'U+0000-00FF');
    expect(extractFontUrlPreferLatin(css)).toBe('https://x/only.woff2');
  });

  it('returns null for CSS without any font URLs', () => {
    expect(extractFontUrlPreferLatin('/* latin */ .foo { color: red; }')).toBeNull();
  });
});
