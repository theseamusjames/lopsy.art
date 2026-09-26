import { describe, it, expect, vi } from 'vitest';

vi.mock('../engine-wasm/wasm-bridge', () => ({ filterMeshWarp: vi.fn() }));

import {
  createIdentityGrid,
  decodeDisplacement,
  encodeDisplacement,
  encodeGridToRgba,
  type MeshWarpGrid,
} from './mesh-warp';

interface Vec2 { x: number; y: number }

/**
 * CPU model of mesh_warp.glsl for a full-texture warp (bounds 0..1):
 * bilinear (LINEAR, CLAMP_TO_EDGE) grid lookup of decoded bytes, then the
 * same damped fixed-point inverse the shader runs.
 */
function sampleDisplacement(data: Uint8Array, cols: number, rows: number, uv: Vec2): Vec2 {
  const lx = Math.max(0, Math.min(1, uv.x));
  const ly = Math.max(0, Math.min(1, uv.y));
  const tx = lx * (cols - 1);
  const ty = ly * (rows - 1);
  const c0 = Math.min(cols - 2, Math.floor(tx));
  const r0 = Math.min(rows - 2, Math.floor(ty));
  const fx = tx - c0;
  const fy = ty - r0;
  const at = (c: number, r: number, ch: number) => decodeDisplacement(data[(r * cols + c) * 4 + ch]!);
  const lerp2 = (ch: number) =>
    at(c0, r0, ch) * (1 - fx) * (1 - fy)
    + at(c0 + 1, r0, ch) * fx * (1 - fy)
    + at(c0, r0 + 1, ch) * (1 - fx) * fy
    + at(c0 + 1, r0 + 1, ch) * fx * fy;
  return { x: lerp2(0), y: lerp2(1) };
}

function shaderSourceUv(data: Uint8Array, cols: number, rows: number, uv: Vec2): Vec2 {
  let src = { x: uv.x, y: uv.y };
  for (let i = 0; i < 16; i++) {
    const d = sampleDisplacement(data, cols, rows, src);
    src = { x: src.x + (uv.x - d.x - src.x) * 0.5, y: src.y + (uv.y - d.y - src.y) * 0.5 };
  }
  return src;
}

function dragPoint(grid: MeshWarpGrid, idx: number, dx: number, dy: number): MeshWarpGrid {
  const points = [...grid.points];
  const p = points[idx]!;
  points[idx] = { x: p.x + dx, y: p.y + dy };
  return { ...grid, points };
}

describe('displacement encoding (#909)', () => {
  it('encodes zero displacement to a byte that decodes to exactly zero', () => {
    const byte = encodeDisplacement(0);
    expect(decodeDisplacement(byte)).toBe(0);
  });

  it('does not drift when a zero displacement round-trips repeatedly', () => {
    let d = 0;
    for (let i = 0; i < 100; i++) {
      d = decodeDisplacement(encodeDisplacement(d));
    }
    expect(d).toBe(0);
  });

  it('encodes an untouched identity grid as exact zero offsets', () => {
    const grid = createIdentityGrid(4, 4);
    const data = encodeGridToRgba(grid, 1, 1);
    for (let i = 0; i < 16; i++) {
      expect(decodeDisplacement(data[i * 4]!)).toBe(0);
      expect(decodeDisplacement(data[i * 4 + 1]!)).toBe(0);
    }
  });

  it('is symmetric and round-trips within one quantisation step', () => {
    for (const d of [-1, -0.5, -0.1, -0.01, 0.01, 0.1, 0.5, 1]) {
      const decoded = decodeDisplacement(encodeDisplacement(d));
      expect(Math.abs(decoded - d)).toBeLessThanOrEqual(0.5 / 127 + 1e-12);
      expect(decodeDisplacement(encodeDisplacement(-d))).toBeCloseTo(-decoded, 12);
    }
  });

  it('uses the full byte range for the extreme displacements', () => {
    expect(encodeDisplacement(1)).toBe(255);
    expect(encodeDisplacement(-1)).toBe(1);
    expect(encodeDisplacement(5)).toBe(255);
    expect(encodeDisplacement(-5)).toBe(1);
  });

  it('leaves every sample of an identity grid unmoved through the shader model', () => {
    const grid = createIdentityGrid(4, 4);
    const data = encodeGridToRgba(grid, 1, 1);
    for (const uv of [{ x: 0, y: 0 }, { x: 0.37, y: 0.81 }, { x: 1, y: 1 }]) {
      expect(shaderSourceUv(data, 4, 4, uv)).toEqual(uv);
    }
  });
});

describe('warp direction (#911)', () => {
  const cols = 4;
  const rows = 4;
  // Inner handle at identity (2/3, 1/3).
  const handleIdx = 1 * cols + 2;
  const origin = { x: 2 / 3, y: 1 / 3 };

  it('encodes a rightward drag as a positive X displacement', () => {
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, 0.1, 0);
    const data = encodeGridToRgba(grid, 1, 1);
    expect(decodeDisplacement(data[handleIdx * 4]!)).toBeGreaterThan(0);
    expect(decodeDisplacement(data[handleIdx * 4 + 1]!)).toBe(0);
  });

  it('moves the content under a handle to where the handle was dragged', () => {
    const d = { x: 0.1, y: -0.05 };
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, d.x, d.y);
    const data = encodeGridToRgba(grid, 1, 1);
    const dragged = { x: origin.x + d.x, y: origin.y + d.y };
    const src = shaderSourceUv(data, cols, rows, dragged);
    // Quantisation is 1/127 per axis; the inverse should land on the handle's
    // original content within that.
    expect(Math.abs(src.x - origin.x)).toBeLessThan(1 / 127);
    expect(Math.abs(src.y - origin.y)).toBeLessThan(1 / 127);
  });

  it('samples content from behind the drag, not ahead of it', () => {
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, 0.1, 0);
    const data = encodeGridToRgba(grid, 1, 1);
    const src = shaderSourceUv(data, cols, rows, origin);
    expect(src.x).toBeLessThan(origin.x);
  });

  it('follows a leftward drag too', () => {
    const d = -0.15;
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, d, 0);
    const data = encodeGridToRgba(grid, 1, 1);
    const src = shaderSourceUv(data, cols, rows, { x: origin.x + d, y: origin.y });
    expect(Math.abs(src.x - origin.x)).toBeLessThan(1 / 127);
  });
});
