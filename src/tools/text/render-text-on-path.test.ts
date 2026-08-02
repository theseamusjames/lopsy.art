import { describe, it, expect } from 'vitest';
import { computeBounds } from './render-text-on-path';
import type { GlyphPlacement } from './text-on-path';

// #695 — path-text rasterization used to size to the full document, producing
// a 64 MB canvas on a 4096×4096 doc. The fix is a per-glyph bounding box.
// These tests pin the bbox math so a regression can't silently reintroduce
// the full-document allocation.

function placement(x: number, y: number, char = 'A', charIndex = 0, rotation = 0): GlyphPlacement {
  return { charIndex, char, x, y, rotation };
}

describe('renderTextOnPath / computeBounds', () => {
  it('returns null when there are no placements', () => {
    expect(computeBounds([], [], 20, 4096, 4096)).toBeNull();
  });

  it('sizes to the glyphs, not the document', () => {
    const placements = [placement(100, 200), placement(120, 200), placement(140, 200)];
    const bounds = computeBounds(placements, [16, 16, 16], 20, 4096, 4096);
    expect(bounds).not.toBeNull();
    // Bounded — must be radically smaller than the doc on both axes.
    // A 20px font over ~40px of horizontal extent should never approach 4K.
    expect(bounds!.w).toBeLessThan(200);
    expect(bounds!.h).toBeLessThan(200);
  });

  it('encloses every placement with padding for ascender + advance', () => {
    // Padding = fontSize + advance/2. With fontSize=20 and advance=16 the
    // extent per glyph is 28 units from centre. A single glyph at (500, 500)
    // must produce a bbox spanning at least (472,472)..(528,528).
    const bounds = computeBounds([placement(500, 500)], [16], 20, 4096, 4096);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThanOrEqual(472);
    expect(bounds!.y).toBeLessThanOrEqual(472);
    expect(bounds!.x + bounds!.w).toBeGreaterThanOrEqual(528);
    expect(bounds!.y + bounds!.h).toBeGreaterThanOrEqual(528);
  });

  it('clips against the document — never returns negative origin or overflow', () => {
    // Glyph at the origin — half its bbox would go negative; must be clipped
    // to 0.
    const bounds = computeBounds([placement(0, 0)], [16], 20, 100, 100);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    expect(bounds!.x + bounds!.w).toBeLessThanOrEqual(100);
    expect(bounds!.y + bounds!.h).toBeLessThanOrEqual(100);
  });

  it('returns null when every placement is outside the document', () => {
    // Glyph is beyond the far edge; after clip, w or h collapses to <= 0.
    const bounds = computeBounds([placement(5000, 5000)], [16], 20, 100, 100);
    expect(bounds).toBeNull();
  });

  it('unions bounds across many placements', () => {
    const placements = [
      placement(100, 100),
      placement(200, 300),
      placement(400, 150),
    ];
    const bounds = computeBounds(placements, [16, 16, 16], 20, 4096, 4096);
    expect(bounds).not.toBeNull();
    // Must cover the extremes of every placement centre.
    expect(bounds!.x).toBeLessThanOrEqual(100);
    expect(bounds!.y).toBeLessThanOrEqual(100);
    expect(bounds!.x + bounds!.w).toBeGreaterThanOrEqual(400);
    expect(bounds!.y + bounds!.h).toBeGreaterThanOrEqual(300);
  });

  it('scales bbox padding with fontSize', () => {
    const smallFont = computeBounds([placement(1000, 1000)], [16], 12, 4096, 4096);
    const largeFont = computeBounds([placement(1000, 1000)], [16], 96, 4096, 4096);
    expect(smallFont).not.toBeNull();
    expect(largeFont).not.toBeNull();
    // A 96px glyph must reserve more room than a 12px glyph.
    expect(largeFont!.w).toBeGreaterThan(smallFont!.w);
    expect(largeFont!.h).toBeGreaterThan(smallFont!.h);
  });

  it('never returns a doc-sized bbox for a short glyph run on a large doc', () => {
    // Regression guard for #695 — a five-glyph label on a 4K doc must not
    // rasterize into a 4K×4K surface.
    const placements = [
      placement(100, 100, 'H', 0),
      placement(115, 100, 'e', 1),
      placement(125, 100, 'l', 2),
      placement(135, 100, 'l', 3),
      placement(150, 100, 'o', 4),
    ];
    const bounds = computeBounds(placements, [15, 10, 10, 15, 20], 20, 4096, 4096);
    expect(bounds).not.toBeNull();
    // Bail before the render if the bbox ever grows to document scale.
    expect(bounds!.w * bounds!.h).toBeLessThan(4096 * 4096 / 100);
  });
});
