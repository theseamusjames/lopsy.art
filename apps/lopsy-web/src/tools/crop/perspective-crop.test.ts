// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import {
  computePerspectiveTransform,
  applyPerspectiveWarp,
  inferOutputSize,
  type Quad,
} from './perspective-crop';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuadFromRect(x: number, y: number, w: number, h: number): Quad {
  return {
    topLeft:     { x: x,     y: y },
    topRight:    { x: x + w, y: y },
    bottomRight: { x: x + w, y: y + h },
    bottomLeft:  { x: x,     y: y + h },
  };
}

function applyMatrix(m: ReturnType<typeof computePerspectiveTransform>, u: number, v: number) {
  const denom = m[6] * u + m[7] * v + 1;
  return {
    x: (m[0] * u + m[1] * v + m[2]) / denom,
    y: (m[3] * u + m[4] * v + m[5]) / denom,
  };
}

// ---------------------------------------------------------------------------
// computePerspectiveTransform
// ---------------------------------------------------------------------------

describe('computePerspectiveTransform', () => {
  it('identity quad maps output corners to source corners unchanged', () => {
    const W = 100;
    const H = 80;
    const quad = makeQuadFromRect(0, 0, W, H);
    const m = computePerspectiveTransform(quad, W, H);

    const corners = [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ] as const;
    const srcCorners = [
      { x: 0,  y: 0  },
      { x: W,  y: 0  },
      { x: W,  y: H  },
      { x: 0,  y: H  },
    ];

    for (let i = 0; i < 4; i++) {
      const [u, v] = corners[i]!;
      const mapped = applyMatrix(m, u, v);
      expect(mapped.x).toBeCloseTo(srcCorners[i]!.x, 3);
      expect(mapped.y).toBeCloseTo(srcCorners[i]!.y, 3);
    }
  });

  it('maps destination corners to the correct source quad corners', () => {
    // A quad that is a perspective-distorted trapezoid
    const quad: Quad = {
      topLeft:     { x: 20, y: 10 },
      topRight:    { x: 80, y: 15 },
      bottomRight: { x: 90, y: 70 },
      bottomLeft:  { x: 10, y: 65 },
    };
    const dstW = 100;
    const dstH = 80;
    const m = computePerspectiveTransform(quad, dstW, dstH);

    // Top-left dst (0,0) → top-left src
    const tl = applyMatrix(m, 0, 0);
    expect(tl.x).toBeCloseTo(20, 2);
    expect(tl.y).toBeCloseTo(10, 2);

    // Top-right dst (dstW,0) → top-right src
    const tr = applyMatrix(m, dstW, 0);
    expect(tr.x).toBeCloseTo(80, 2);
    expect(tr.y).toBeCloseTo(15, 2);

    // Bottom-right dst (dstW,dstH) → bottom-right src
    const br = applyMatrix(m, dstW, dstH);
    expect(br.x).toBeCloseTo(90, 2);
    expect(br.y).toBeCloseTo(70, 2);

    // Bottom-left dst (0,dstH) → bottom-left src
    const bl = applyMatrix(m, 0, dstH);
    expect(bl.x).toBeCloseTo(10, 2);
    expect(bl.y).toBeCloseTo(65, 2);
  });

  it('translating the quad shifts the inverse-mapped source coordinates', () => {
    const quad = makeQuadFromRect(50, 30, 100, 80);
    const m = computePerspectiveTransform(quad, 100, 80);

    const tl = applyMatrix(m, 0, 0);
    expect(tl.x).toBeCloseTo(50, 2);
    expect(tl.y).toBeCloseTo(30, 2);
  });
});

// ---------------------------------------------------------------------------
// applyPerspectiveWarp
// ---------------------------------------------------------------------------

describe('applyPerspectiveWarp', () => {
  it('identity warp produces the same pixels as the source', () => {
    const W = 4;
    const H = 4;
    const src = new ImageData(W, H);
    for (let i = 0; i < src.data.length; i++) {
      src.data[i] = (i % 251) + 1; // non-zero, non-trivial pattern
    }
    src.data[3] = 255;
    src.data[7] = 255;
    src.data[11] = 255;
    src.data[15] = 255;

    // Fill alpha to 255 for all pixels so bilinear interpolation stays clean
    for (let j = 3; j < W * H * 4; j += 4) {
      src.data[j] = 255;
    }
    for (let j = 0; j < W * H * 4; j += 4) {
      src.data[j]     = (j / 4) * 10 % 256;
      src.data[j + 1] = (j / 4) * 20 % 256;
      src.data[j + 2] = (j / 4) * 5  % 256;
      src.data[j + 3] = 255;
    }

    const quad = makeQuadFromRect(0, 0, W, H);
    const m = computePerspectiveTransform(quad, W, H);
    const out = applyPerspectiveWarp(src, m, W, H);

    // All interior pixels should match exactly
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        expect(out.data[idx]).toBeCloseTo(src.data[idx]!, 0);
        expect(out.data[idx + 1]).toBeCloseTo(src.data[idx + 1]!, 0);
        expect(out.data[idx + 2]).toBeCloseTo(src.data[idx + 2]!, 0);
        expect(out.data[idx + 3]).toBeCloseTo(src.data[idx + 3]!, 0);
      }
    }
  });

  it('output dimensions match the requested size', () => {
    const src = new ImageData(100, 100);
    const quad = makeQuadFromRect(0, 0, 100, 100);
    const m = computePerspectiveTransform(quad, 60, 40);
    const out = applyPerspectiveWarp(src, m, 60, 40);
    expect(out.width).toBe(60);
    expect(out.height).toBe(40);
  });

  it('samples source region correctly for a simple sub-rect quad', () => {
    // Paint the top-left 10×10 of a 20×20 canvas red, rest blue.
    // Quad covers exactly the top-left 10×10 corner.
    const src = new ImageData(20, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const idx = (y * 20 + x) * 4;
        if (x < 10 && y < 10) {
          src.data[idx]     = 255; // red
          src.data[idx + 1] = 0;
          src.data[idx + 2] = 0;
          src.data[idx + 3] = 255;
        } else {
          src.data[idx]     = 0;
          src.data[idx + 1] = 0;
          src.data[idx + 2] = 255; // blue
          src.data[idx + 3] = 255;
        }
      }
    }

    const quad = makeQuadFromRect(0, 0, 10, 10);
    const m = computePerspectiveTransform(quad, 10, 10);
    const out = applyPerspectiveWarp(src, m, 10, 10);

    // Centre pixel of output should be red
    const cx = 5;
    const cy = 5;
    const oi = (cy * 10 + cx) * 4;
    expect(out.data[oi]).toBeGreaterThan(200);
    expect(out.data[oi + 2]).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// inferOutputSize
// ---------------------------------------------------------------------------

describe('inferOutputSize', () => {
  it('returns the exact rect dimensions for an axis-aligned quad', () => {
    const quad = makeQuadFromRect(10, 20, 100, 80);
    const { width, height } = inferOutputSize(quad);
    expect(width).toBe(100);
    expect(height).toBe(80);
  });

  it('returns the average of opposite edge lengths for a trapezoid', () => {
    // top edge: 60px, bottom edge: 100px → avg width = 80
    // left edge: straight vertical 50px, right edge: straight vertical 50px → avg height = 50
    const quad: Quad = {
      topLeft:     { x: 20,  y: 0  },
      topRight:    { x: 80,  y: 0  },   // top: 60 px
      bottomRight: { x: 80,  y: 50 },   // right: 50 px (vertical)
      bottomLeft:  { x: 20,  y: 50 },   // bottom: 60 px; left: 50 px (vertical)
    };
    // avg width = (60+60)/2 = 60, avg height = (50+50)/2 = 50
    const { width, height } = inferOutputSize(quad);
    expect(width).toBe(60);
    expect(height).toBe(50);
  });

  it('clamps output to at least 1×1 for degenerate quads', () => {
    const quad: Quad = {
      topLeft:     { x: 0, y: 0 },
      topRight:    { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft:  { x: 0, y: 0 },
    };
    const { width, height } = inferOutputSize(quad);
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
