import { describe, it, expect } from 'vitest';
import {
  glyphBoxContains,
  glyphBoxesBounds,
  glyphInkRect,
  offsetGlyphBoxes,
  placeGlyphBoxes,
  type GlyphInkRect,
  type PlacedGlyphBox,
} from './path-text-geometry';
import type { GlyphPlacement } from './text-on-path';

function placement(x: number, y: number, rotation = 0, charIndex = 0): GlyphPlacement {
  return { charIndex, char: 'A', x, y, rotation };
}

/** A 30-wide, 36-tall capital centred on its 30 px advance. */
const CAP: GlyphInkRect = { left: -15, right: 15, top: -36, bottom: 0 };

function box(x: number, y: number, rotation = 0, ink: GlyphInkRect = CAP): PlacedGlyphBox {
  return { ...ink, x, y, rotation };
}

describe('glyphInkRect', () => {
  it('locates the ink relative to the centre of the advance', () => {
    // fillText draws at -advance/2: a 40 px advance with 3 px of left side
    // bearing (actualBoundingBoxLeft = -3) and ink to x = 37.
    const rect = glyphInkRect({
      actualBoundingBoxLeft: -3,
      actualBoundingBoxRight: 37,
      actualBoundingBoxAscent: 50,
      actualBoundingBoxDescent: 2,
    }, 40);
    expect(rect).toEqual({ left: -17, right: 17, top: -50, bottom: 2 });
  });

  it('returns null for glyphs without ink', () => {
    expect(glyphInkRect({
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
    }, 12)).toBeNull();
  });
});

describe('placeGlyphBoxes', () => {
  it('skips glyphs without ink and keeps each placement transform', () => {
    const placements = [placement(10, 20, 0.5, 0), placement(30, 20, 0.6, 1), placement(50, 20, 0.7, 2)];
    const boxes = placeGlyphBoxes(placements, [CAP, null, CAP]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ ...CAP, x: 10, y: 20, rotation: 0.5 });
    expect(boxes[1]).toEqual({ ...CAP, x: 50, y: 20, rotation: 0.7 });
  });
});

describe('glyphBoxesBounds', () => {
  it('hugs upright ink plus the padding (#1174)', () => {
    // Capitals on a baseline at y=450 with 50 px type: the ink ends at the
    // baseline, so nothing reaches a click 45 px below it.
    const bounds = glyphBoxesBounds([box(300, 450), box(330, 450)], 2, 800, 600)!;
    expect(bounds).toEqual({ x: 283, y: 412, w: 64, h: 40 });
  });

  it('covers a rotated glyph by its rotated corners', () => {
    // A quarter turn maps (u, v) to (-v, u): the 30×36 box stands 36 wide
    // and 30 tall, to the right of x=100.
    // Rounding outward may add a pixel on each side.
    const bounds = glyphBoxesBounds([box(100, 100, Math.PI / 2)], 0, 800, 600)!;
    expect(bounds.x).toBeGreaterThanOrEqual(99);
    expect(bounds.x).toBeLessThanOrEqual(100);
    expect(bounds.x + bounds.w).toBeGreaterThanOrEqual(136);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(137);
    expect(bounds.y).toBeGreaterThanOrEqual(84);
    expect(bounds.y).toBeLessThanOrEqual(85);
    expect(bounds.y + bounds.h).toBeGreaterThanOrEqual(115);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(116);
  });

  it('returns null without boxes', () => {
    expect(glyphBoxesBounds([], 2, 800, 600)).toBeNull();
  });

  it('clips against the document', () => {
    const bounds = glyphBoxesBounds([box(5, 20)], 2, 100, 100)!;
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(100);
  });

  it('returns null when every glyph is outside the document', () => {
    expect(glyphBoxesBounds([box(5000, 5000)], 2, 100, 100)).toBeNull();
  });

  it('never returns a doc-sized box for a short run on a large document (#695)', () => {
    const boxes = [box(100, 100), box(130, 100), box(160, 100)];
    const bounds = glyphBoxesBounds(boxes, 2, 4096, 4096)!;
    expect(bounds.w * bounds.h).toBeLessThan(4096 * 4096 / 100);
  });
});

describe('offsetGlyphBoxes', () => {
  it('moves every box without touching its shape', () => {
    expect(offsetGlyphBoxes([box(300, 450, 0.2)], -283, -412)).toEqual([box(17, 38, 0.2)]);
  });
});

describe('glyphBoxContains', () => {
  it('contains points on the ink and within the slop', () => {
    const b = box(300, 450);
    expect(glyphBoxContains(b, { x: 300, y: 430 }, 4)).toBe(true);
    expect(glyphBoxContains(b, { x: 318, y: 453 }, 4)).toBe(true);
  });

  it('rejects points beyond the slop', () => {
    const b = box(300, 450);
    expect(glyphBoxContains(b, { x: 300, y: 455 }, 4)).toBe(false);
    expect(glyphBoxContains(b, { x: 320, y: 430 }, 4)).toBe(false);
  });

  it('tests in the glyph frame of a rotated glyph', () => {
    // Rotated a quarter turn the box spans x 100..136, y 85..115.
    const b = box(100, 100, Math.PI / 2);
    expect(glyphBoxContains(b, { x: 130, y: 90 }, 0)).toBe(true);
    // Inside the upright box, outside the rotated one.
    expect(glyphBoxContains(b, { x: 95, y: 70 }, 0)).toBe(false);
  });
});
