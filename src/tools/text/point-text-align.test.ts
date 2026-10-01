import { describe, it, expect } from 'vitest';
import {
  alignmentAnchorShift,
  anchorShareOfWidth,
  blockWidthFromGlyphs,
  isPointTextLayout,
} from './point-text-align';

describe('anchorShareOfWidth', () => {
  it('puts the anchor at the left edge, centre or right edge', () => {
    expect(anchorShareOfWidth('left')).toBe(0);
    expect(anchorShareOfWidth('center')).toBe(0.5);
    expect(anchorShareOfWidth('right')).toBe(1);
  });

  it('treats justify like left — point text never wraps, so nothing stretches', () => {
    expect(anchorShareOfWidth('justify')).toBe(0);
  });
});

describe('isPointTextLayout', () => {
  it('is point text only without an area box and when horizontal', () => {
    expect(isPointTextLayout(null, false)).toBe(true);
    expect(isPointTextLayout(300, false)).toBe(false);
    expect(isPointTextLayout(null, true)).toBe(false);
  });
});

describe('alignmentAnchorShift', () => {
  it('moves the anchor across the block so its left edge stays put', () => {
    // Block 200 wide at anchor 100, left-aligned: spans 100..300.
    // Centred about anchor 200 it still spans 100..300.
    expect(alignmentAnchorShift('left', 'center', 200)).toBe(100);
    expect(alignmentAnchorShift('left', 'right', 200)).toBe(200);
    expect(alignmentAnchorShift('right', 'center', 200)).toBe(-100);
    expect(alignmentAnchorShift('center', 'left', 200)).toBe(-100);
  });

  it('does not move the anchor when the alignment is unchanged or the block is empty', () => {
    expect(alignmentAnchorShift('center', 'center', 200)).toBe(0);
    expect(alignmentAnchorShift('left', 'justify', 200)).toBe(0);
    expect(alignmentAnchorShift('left', 'right', 0)).toBe(0);
  });
});

describe('blockWidthFromGlyphs', () => {
  it('spans the leftmost glyph to the rightmost glyph edge across lines', () => {
    // Line 1: glyphs at -50 (w 40) and -10 (w 60) → -50..50.
    // Line 2: one glyph at -20 (w 40) → -20..20.
    const positions = [-50, 0, 40, 28, 0, -10, 0, 60, 28, 1, -20, 28, 40, 28, 3];
    expect(blockWidthFromGlyphs(positions)).toBe(100);
  });

  it('is zero with no glyphs', () => {
    expect(blockWidthFromGlyphs([])).toBe(0);
  });
});
