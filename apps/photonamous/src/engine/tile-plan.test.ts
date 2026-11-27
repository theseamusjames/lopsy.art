import { describe, expect, it } from 'vitest';
import { MAX_OVERDRAW, frameRect, planTiles, tileSizeCount, turnedWindow, turnedWindowSize, unframeRect, type PixelRect, type TilePlan, type TilePlanInput } from './tile-plan';
import type { Framing } from './recipe-to-adjustments';

const Q2 = { width: 8368, height: 5584 };
const HELD_Q2 = 8190 * 5465;

function plan(input: Partial<TilePlanInput> & Pick<TilePlanInput, 'document'>): TilePlan {
  const p = planTiles({ limit: 8190, maxTilePixels: HELD_Q2, apron: 0, angle: 0, ...input });
  if (!p) throw new Error('no plan');
  return p;
}

/** Every pixel of the document in exactly one kept part. */
function expectPartition(p: TilePlan, document: { width: number; height: number }): void {
  const covered = new Uint8Array(document.width * document.height);
  for (const { kept } of p.tiles) {
    for (let y = kept.y; y < kept.y + kept.height; y++) for (let x = kept.x; x < kept.x + kept.width; x++) covered[y * document.width + x]! += 1;
  }
  expect(covered.every((n) => n === 1)).toBe(true);
}

function expectWithin(p: TilePlan, input: { limit: number; maxTilePixels: number; apron: number; document: { width: number; height: number } }): void {
  for (const { kept, rect } of p.tiles) {
    expect(kept.x % 2, `kept at ${kept.x}`).toBe(0);
    expect(kept.y % 2, `kept at ${kept.y}`).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(input.limit);
    expect(rect.height).toBeLessThanOrEqual(input.limit);
    expect(rect.width * rect.height).toBeLessThanOrEqual(input.maxTilePixels);
    // The apron on every side that is not the document's edge.
    if (kept.x > 0) expect(kept.x - rect.x).toBeGreaterThanOrEqual(input.apron);
    if (kept.y > 0) expect(kept.y - rect.y).toBeGreaterThanOrEqual(input.apron);
    if (kept.x + kept.width < input.document.width) expect(rect.x + rect.width - kept.x - kept.width).toBeGreaterThanOrEqual(input.apron);
    if (kept.y + kept.height < input.document.height) expect(rect.y + rect.height - kept.y - kept.height).toBeGreaterThanOrEqual(input.apron);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(input.document.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(input.document.height);
  }
}

describe('planTiles', () => {
  it('plans one tile, the document, for a document that fits', () => {
    const document = { width: 8190, height: 5465 };
    const p = plan({ document, apron: 466 });
    expect([p.columns, p.rows, p.overdraw]).toEqual([1, 1, 1]);
    expect(p.tiles).toEqual([{ kept: { x: 0, y: 0, ...document }, rect: { x: 0, y: 0, ...document } }]);
  });

  it('cuts a Leica Q2 in two on an 8192 GPU, with the largest apron of every stage', () => {
    const input = { document: Q2, limit: 8190, maxTilePixels: HELD_Q2, apron: 466, angle: 0 };
    const p = plan(input);
    expect(p.tiles).toHaveLength(2);
    expect([p.columns, p.rows]).toEqual([2, 1]);
    expectPartition(p, Q2);
    expectWithin(p, input);
    expect(tileSizeCount(p)).toBeLessThanOrEqual(2);
  });

  it('keeps every tile but the last in a row or column the same size', () => {
    const document = { width: 3000, height: 2000 };
    const input = { document, limit: 2046, maxTilePixels: 2046 * 1364, apron: 466, angle: 0 };
    const p = plan(input);
    expectPartition(p, document);
    expectWithin(p, input);
    expect(tileSizeCount(p)).toBeLessThanOrEqual(4);
    expect(p.overdraw).toBeLessThanOrEqual(MAX_OVERDRAW);
  });

  it('takes the fewest tiles: 4 × 2 rather than 3 × 3 for a small limit and no apron', () => {
    const document = { width: 1600, height: 1100 };
    const input = { document, limit: 638, maxTilePixels: 638 * 439, apron: 0, angle: 0 };
    const p = plan(input);
    expect([p.columns, p.rows]).toEqual([4, 2]);
    expect(p.overdraw).toBe(1);
    expectPartition(p, document);
    expectWithin(p, input);
  });

  it('rounds an odd apron up to even, so the kept parts stay on even pixels', () => {
    const document = { width: 1600, height: 1100 };
    const input = { document, limit: 1000, maxTilePixels: 1000 * 688, apron: 27, angle: 0 };
    const p = plan(input);
    expect(p.apron).toBe(28);
    expectPartition(p, document);
    expectWithin(p, { ...input, apron: 28 });
  });

  it('keeps a turned tile small enough that the window it is turned from fits', () => {
    const document = { width: 6000, height: 4000 };
    const input = { document, limit: 4094, maxTilePixels: 4094 * 2729, apron: 100, angle: 10 };
    const p = plan(input);
    expectPartition(p, document);
    expectWithin(p, input);
    for (const { rect } of p.tiles) {
      const window = turnedWindowSize(rect.width, rect.height, 10);
      expect(window.width).toBeLessThanOrEqual(4094);
      expect(window.height).toBeLessThanOrEqual(4094);
    }
  });

  it('gives up when the apron would be most of every tile', () => {
    const document = { width: 3000, height: 2000 };
    expect(planTiles({ document, limit: 2046, maxTilePixels: 2046 * 1364, apron: 900, angle: 0 })).toBeNull();
    // Just inside: the same limit with a quarter of it as apron still plans.
    expect(planTiles({ document, limit: 2046, maxTilePixels: 2046 * 1364, apron: 400, angle: 0 })).not.toBeNull();
  });
});

describe('the window a tile is made from', () => {
  const source = { width: 40, height: 30 };
  const framings: Framing[] = [0, 90, 180, 270].flatMap((rotate) => [false, true].map((flipH) => ({ rotate: rotate as Framing['rotate'], flipH })));

  it('unframes a rectangle as the inverse of framing it, for every rotation and mirror', () => {
    const rect: PixelRect = { x: 3, y: 5, width: 11, height: 7 };
    for (const framing of framings) {
      const framed = frameRect(rect, framing, source);
      expect(unframeRect(framed, framing, source), JSON.stringify(framing)).toEqual(rect);
    }
  });

  it('frames as the engine turns a texture: clockwise, then mirrored', () => {
    // The top-left pixel of a 40 × 30 image, turned a quarter clockwise, is the top-right of the 30 × 40 one.
    expect(frameRect({ x: 0, y: 0, width: 1, height: 1 }, { rotate: 90, flipH: false }, source)).toEqual({ x: 29, y: 0, width: 1, height: 1 });
    expect(frameRect({ x: 0, y: 0, width: 1, height: 1 }, { rotate: 90, flipH: true }, source)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(frameRect({ x: 0, y: 0, width: 1, height: 1 }, { rotate: 180, flipH: false }, source)).toEqual({ x: 39, y: 29, width: 1, height: 1 });
  });

  it('is the rectangle itself when the photo is not turned', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(turnedWindow(rect, 0, { width: 100, height: 100 })).toEqual(rect);
  });

  it('holds every point the turned tile reads, with the margin, inside the framed image', () => {
    const framed = { width: 1000, height: 600 };
    const rect = { x: 700, y: 100, width: 200, height: 150 };
    const angle = 12;
    const window = turnedWindow(rect, angle, framed);
    const t = (angle * Math.PI) / 180;
    for (const [x, y] of [
      [700, 100],
      [900, 250],
      [800, 175],
    ] as const) {
      const sx = Math.cos(t) * (x - 500) + Math.sin(t) * (y - 300) + 500;
      const sy = -Math.sin(t) * (x - 500) + Math.cos(t) * (y - 300) + 300;
      expect(sx).toBeGreaterThanOrEqual(window.x + 1);
      expect(sx).toBeLessThanOrEqual(window.x + window.width - 1);
      expect(sy).toBeGreaterThanOrEqual(window.y + 1);
      expect(sy).toBeLessThanOrEqual(window.y + window.height - 1);
    }
    const size = turnedWindowSize(rect.width, rect.height, angle);
    expect(window.width).toBeLessThanOrEqual(size.width);
    expect(window.height).toBeLessThanOrEqual(size.height);
    // Clipped at the framed image's edge.
    const edge = turnedWindow({ x: 0, y: 0, width: 100, height: 100 }, 20, framed);
    expect(edge.x).toBeGreaterThanOrEqual(0);
    expect(edge.y).toBeGreaterThanOrEqual(0);
  });
});
