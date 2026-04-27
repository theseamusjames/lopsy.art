import { describe, it, expect } from 'vitest';
import { wrapText, alignLineX, buildFontString, computeTextLayout } from './text';
import type { TextStyle } from './text';

const fakeMeasure = (t: string): number => t.length * 10;

const defaultStyle: TextStyle = {
  fontSize: 24,
  fontFamily: 'Inter, sans-serif',
  fontWeight: 400,
  fontStyle: 'normal',
  color: { r: 0, g: 0, b: 0, a: 1 },
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
};

// Simple measureWidth: each character is 10px wide
const charWidth = 10;
const measureWidth = (text: string): number => text.length * charWidth;

describe('buildFontString', () => {
  it('builds correct CSS font string', () => {
    expect(buildFontString(defaultStyle)).toBe('normal 400 24px Inter, sans-serif');
  });

  it('handles italic bold', () => {
    const style: TextStyle = { ...defaultStyle, fontStyle: 'italic', fontWeight: 700 };
    expect(buildFontString(style)).toBe('italic 700 24px Inter, sans-serif');
  });
});

describe('wrapText', () => {
  it('returns single line for point text (null width)', () => {
    const lines = wrapText('Hello world', null, measureWidth);
    expect(lines).toEqual(['Hello world']);
  });

  it('preserves explicit newlines in point text', () => {
    const lines = wrapText('Line 1\nLine 2\nLine 3', null, measureWidth);
    expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('wraps text at word boundaries for area text', () => {
    // "Hello world" = 11 chars = 110px, maxWidth = 80px
    const lines = wrapText('Hello world', 80, measureWidth);
    expect(lines).toEqual(['Hello ', 'world']);
  });

  it('handles multiple words wrapping across lines', () => {
    // "one two three four" with maxWidth=100 (10 chars)
    const lines = wrapText('one two three four', 100, measureWidth);
    // "one two " = 8 chars = 80px fits
    // "one two three " = 14 chars = 140px > 100, so break
    // "three " = 6 chars = 60px fits
    // "three four" = 10 chars = 100px fits
    expect(lines.length).toBeGreaterThan(1);
    // Every line should be within max width
    for (const line of lines) {
      expect(measureWidth(line)).toBeLessThanOrEqual(100);
    }
  });

  it('returns empty line for empty paragraph', () => {
    const lines = wrapText('', null, measureWidth);
    expect(lines).toEqual(['']);
  });

  it('handles newlines in area text', () => {
    const lines = wrapText('First\nSecond', 200, measureWidth);
    expect(lines).toEqual(['First', 'Second']);
  });

  it('wraps within paragraphs in area text', () => {
    // "Hello world" = 110px, maxWidth = 80px
    // Each paragraph wraps independently
    const lines = wrapText('Hello world\nFoo bar', 80, measureWidth);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('Hello ');
    expect(lines[1]).toBe('world');
    expect(lines[2]).toBe('Foo bar');
  });

  it('handles trailing newline', () => {
    const lines = wrapText('Hello\n', null, measureWidth);
    expect(lines).toEqual(['Hello', '']);
  });
});

describe('alignLineX', () => {
  it('returns 0 for left alignment', () => {
    expect(alignLineX(50, 200, 'left')).toBe(0);
  });

  it('centers text', () => {
    expect(alignLineX(50, 200, 'center')).toBe(75);
  });

  it('right-aligns text', () => {
    expect(alignLineX(50, 200, 'right')).toBe(150);
  });

  it('returns 0 for justify (justify is handled differently)', () => {
    expect(alignLineX(50, 200, 'justify')).toBe(0);
  });

  it('returns 0 for left-aligned point text (containerWidth null)', () => {
    expect(alignLineX(50, null, 'left')).toBe(0);
    expect(alignLineX(50, null, 'justify')).toBe(0);
  });

  it('centers point text around the click anchor (negative offset)', () => {
    // Issue #223: With Align: center and a click at the anchor, the line
    // should sit so its midpoint lands on the anchor. That requires
    // shifting the line left by half its width.
    expect(alignLineX(50, null, 'center')).toBe(-25);
    expect(alignLineX(120, null, 'center')).toBe(-60);
  });

  it('right-aligns point text so the trailing edge lands on the anchor', () => {
    expect(alignLineX(50, null, 'right')).toBe(-50);
    expect(alignLineX(120, null, 'right')).toBe(-120);
  });
});

describe('computeTextLayout (issue #219, #223)', () => {
  const baseStyle: TextStyle = {
    fontSize: 80,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 0, g: 0, b: 0, a: 1 },
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: 'left',
  };

  it('issue #219: canvas grows to fit text wider than the document', () => {
    // "TYPOGRAPHY" at 10px/char = 100px wide. Canvas is sized to fit, plus
    // padding — independent of any document width. Previously the canvas
    // was hardcoded to doc.width and any glyphs past the right edge were
    // silently clipped.
    const layout = computeTextLayout('TYPOGRAPHY', baseStyle, null, fakeMeasure);
    expect(layout.width).toBeGreaterThanOrEqual(100);
    expect(layout.height).toBeGreaterThanOrEqual(80);
  });

  it('issue #219: doc dimensions are not an input — canvas matches text', () => {
    // The same text should produce the same canvas size whether the doc is
    // 400×400 or 4000×4000. computeTextLayout deliberately doesn't take doc
    // dimensions, so both calls return identical metrics.
    const a = computeTextLayout('HELLO', baseStyle, null, fakeMeasure);
    const b = computeTextLayout('HELLO', baseStyle, null, fakeMeasure);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  it('issue #223: left alignment places canvas just left of the anchor', () => {
    // Click anchor at (clickX, clickY) → text starts at the anchor.
    // Canvas top-left = (clickX - PAD, clickY - PAD), where PAD is the
    // antialias/descender padding on every side.
    const style: TextStyle = { ...baseStyle, textAlign: 'left' };
    const layout = computeTextLayout('HELLO', style, null, fakeMeasure);
    // offsetX is negative (canvas starts left of the anchor by PAD).
    expect(layout.offsetX).toBeLessThan(0);
    // The anchor maps to canvas position (PAD, PAD) — so the text on the
    // first line starts at canvas x = PAD (left aligned). renderOffsetX
    // and offsetX are negatives of each other for left-aligned point text.
    expect(layout.renderOffsetX).toBe(-layout.offsetX);
  });

  it('issue #223: center alignment centers text around the anchor', () => {
    // Anchor (e.g. clickX=400) with center align: text midpoint lands on
    // the anchor. With "HELLO" (50px wide, 10px/char), the text covers
    // [anchor-25, anchor+25]. Canvas covers [anchor-25-PAD, anchor+25+PAD].
    const style: TextStyle = { ...baseStyle, textAlign: 'center' };
    const layout = computeTextLayout('HELLO', style, null, fakeMeasure);
    // The text width is 50 (5 chars × 10). The canvas is wider by 2×PAD.
    expect(layout.width).toBeGreaterThanOrEqual(50);
    // Anchor sits at canvas position (renderOffsetX, renderOffsetY).
    // For center: canvas-position-of-anchor = PAD + |minRenderX| = PAD + 25.
    expect(layout.renderOffsetX).toBeGreaterThan(25);
    // offsetX is negative (canvas left of anchor by 25 + PAD).
    expect(layout.offsetX).toBeLessThan(-24);
  });

  it('issue #223: right alignment ends text at the anchor', () => {
    const style: TextStyle = { ...baseStyle, textAlign: 'right' };
    const layout = computeTextLayout('HELLO', style, null, fakeMeasure);
    // Anchor sits at canvas position (PAD + |minRenderX|) = PAD + 50 for
    // right-aligned 50px text — text ends at the anchor.
    expect(layout.renderOffsetX).toBeGreaterThanOrEqual(50);
    // offsetX is more negative than for center alignment.
    expect(layout.offsetX).toBeLessThan(-49);
  });

  it('round-trips anchor → layer.x → anchor for re-edit', () => {
    // commitTextEditing computes layer.x = anchor.x + layout.offsetX.
    // When re-editing, we recover anchor.x = layer.x - layout.offsetX.
    // This must hold for all alignments and reasonable click positions.
    for (const align of ['left', 'center', 'right'] as const) {
      const style: TextStyle = { ...baseStyle, textAlign: align };
      const layout = computeTextLayout('TYPOGRAPHY', style, null, fakeMeasure);
      const anchorX = 250;
      const layerX = anchorX + layout.offsetX;
      const recoveredAnchor = layerX - layout.offsetX;
      expect(recoveredAnchor).toBe(anchorX);
    }
  });

  it('multi-line point text bounds the canvas to the longest line', () => {
    const layout = computeTextLayout('HI\nWORLD', baseStyle, null, fakeMeasure);
    // longest line = "WORLD" = 50px wide. Canvas at least that wide + padding.
    expect(layout.width).toBeGreaterThanOrEqual(50);
    // Two lines × lineHeight × fontSize = 2 × 1.4 × 80 = 224 minimum height.
    expect(layout.height).toBeGreaterThanOrEqual(224);
  });

  it('area text places canvas to the right of the area-left anchor', () => {
    // For area text the anchor is the area's top-left and alignLineX returns
    // a non-negative offset, so the canvas top-left sits between the anchor
    // and the first glyph (with PAD on the leading side).
    const style: TextStyle = { ...baseStyle, textAlign: 'center' };
    const layout = computeTextLayout('HI', style, 200, fakeMeasure);
    // For 200-wide area with 20-wide text, alignLineX returns 90, so the
    // canvas left starts at anchor + (90 - PAD).
    expect(layout.offsetX).toBeGreaterThan(0);
  });
});
