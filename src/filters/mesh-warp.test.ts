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

/** Decode grid point `index` the way `gridPoint` in mesh_warp.glsl does. */
function gridPoint(data: Uint8Array, index: number): Vec2 {
  const pi = index * 4;
  return {
    x: decodeDisplacement(data[pi]! * 256 + data[pi + 1]!),
    y: decodeDisplacement(data[pi + 2]! * 256 + data[pi + 3]!),
  };
}

interface Sample { d: Vec2; dX: Vec2; dY: Vec2 }

/**
 * CPU model of `displacementAt` in mesh_warp.glsl for a full-texture warp
 * (bounds 0..1): bilinear interpolation of the decoded grid points and the
 * Jacobian of that interpolation.
 */
function displacementAt(data: Uint8Array, cols: number, rows: number, uv: Vec2): Sample {
  const gx = Math.max(0, Math.min(1, uv.x)) * (cols - 1);
  const gy = Math.max(0, Math.min(1, uv.y)) * (rows - 1);
  const c0 = Math.min(cols - 2, Math.floor(gx));
  const r0 = Math.min(rows - 2, Math.floor(gy));
  const fx = gx - c0;
  const fy = gy - r0;
  const d00 = gridPoint(data, r0 * cols + c0);
  const d10 = gridPoint(data, r0 * cols + c0 + 1);
  const d01 = gridPoint(data, (r0 + 1) * cols + c0);
  const d11 = gridPoint(data, (r0 + 1) * cols + c0 + 1);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const insideX = uv.x >= 0 && uv.x <= 1 ? 1 : 0;
  const insideY = uv.y >= 0 && uv.y <= 1 ? 1 : 0;
  return {
    d: {
      x: mix(mix(d00.x, d10.x, fx), mix(d01.x, d11.x, fx), fy),
      y: mix(mix(d00.y, d10.y, fx), mix(d01.y, d11.y, fx), fy),
    },
    dX: {
      x: mix(d10.x - d00.x, d11.x - d01.x, fy) * (cols - 1) * insideX,
      y: mix(d10.y - d00.y, d11.y - d01.y, fy) * (cols - 1) * insideX,
    },
    dY: {
      x: mix(d01.x - d00.x, d11.x - d10.x, fx) * (rows - 1) * insideY,
      y: mix(d01.y - d00.y, d11.y - d10.y, fx) * (rows - 1) * insideY,
    },
  };
}

function residual(data: Uint8Array, cols: number, rows: number, src: Vec2, target: Vec2): Vec2 {
  const { d } = displacementAt(data, cols, rows, src);
  return { x: src.x + d.x - target.x, y: src.y + d.y - target.y };
}

const norm2 = (v: Vec2) => v.x * v.x + v.y * v.y;

/** CPU model of the inverse in mesh_warp.glsl: backtracking Newton steps. */
function shaderSourceUv(data: Uint8Array, cols: number, rows: number, uv: Vec2): Vec2 {
  let src = { x: uv.x, y: uv.y };
  for (let i = 0; i < 12; i++) {
    const { d, dX, dY } = displacementAt(data, cols, rows, src);
    const r = { x: src.x + d.x - uv.x, y: src.y + d.y - uv.y };
    const err = norm2(r);
    if (err < 1e-14) break;
    const a = 1 + dX.x;
    const b = dY.x;
    const c = dX.y;
    const e = 1 + dY.y;
    const det = a * e - b * c;
    const step = det > 1e-6
      ? { x: (e * r.x - b * r.y) / det, y: (a * r.y - c * r.x) / det }
      : { x: r.x * 0.5, y: r.y * 0.5 };
    let t = 1;
    for (let k = 0; k < 4; k++) {
      if (norm2(residual(data, cols, rows, { x: src.x - step.x * t, y: src.y - step.y * t }, uv)) < err) break;
      t *= 0.5;
    }
    src = { x: src.x - step.x * t, y: src.y - step.y * t };
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
  it('encodes zero displacement to a code that decodes to exactly zero', () => {
    const code = encodeDisplacement(0);
    expect(decodeDisplacement(code)).toBe(0);
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
    const data = encodeGridToRgba(grid);
    for (let i = 0; i < 16; i++) {
      expect(gridPoint(data, i)).toEqual({ x: 0, y: 0 });
    }
  });

  it('is symmetric and round-trips within one quantisation step', () => {
    for (const d of [-1, -0.5, -0.1, -0.01, 0.01, 0.1, 0.5, 1]) {
      const decoded = decodeDisplacement(encodeDisplacement(d));
      expect(Math.abs(decoded - d)).toBeLessThanOrEqual(0.5 / 32767 + 1e-12);
      expect(decodeDisplacement(encodeDisplacement(-d))).toBeCloseTo(-decoded, 12);
    }
  });

  it('uses the full 16-bit range for the extreme displacements', () => {
    expect(encodeDisplacement(1)).toBe(65535);
    expect(encodeDisplacement(-1)).toBe(1);
    expect(encodeDisplacement(5)).toBe(65535);
    expect(encodeDisplacement(-5)).toBe(1);
  });

  it('leaves every sample of an identity grid unmoved through the shader model', () => {
    const grid = createIdentityGrid(4, 4);
    const data = encodeGridToRgba(grid);
    for (const uv of [{ x: 0, y: 0 }, { x: 0.37, y: 0.81 }, { x: 1, y: 1 }]) {
      expect(shaderSourceUv(data, 4, 4, uv)).toEqual(uv);
    }
  });
});

describe('displacement precision (#1160)', () => {
  // A 3×3 grid over a 2400 × 800 document: the centre point sits at
  // (1200, 400). One byte per axis quantised its offset to 2400 / 127 ≈
  // 18.9 px horizontally and 800 / 127 ≈ 6.3 px vertically.
  const W = 2400;
  const H = 800;
  const centre = 4;

  it.each([1, 9, 10, 37])('keeps a %i px drag to well under a pixel', (px) => {
    const grid = dragPoint(createIdentityGrid(3, 3), centre, px / W, -px / H);
    const d = gridPoint(encodeGridToRgba(grid), centre);
    expect(Math.abs(d.x * W - px)).toBeLessThan(0.05);
    expect(Math.abs(d.y * H + px)).toBeLessThan(0.05);
  });

  it('moves the content under a 9 px drag by 9 px, not 0', () => {
    const grid = dragPoint(createIdentityGrid(3, 3), centre, 9 / W, 0);
    const data = encodeGridToRgba(grid);
    const src = shaderSourceUv(data, 3, 3, { x: (1200 + 9) / W, y: 0.5 });
    expect(Math.abs(src.x * W - 1200)).toBeLessThan(0.05);
  });
});

describe('inverse under strong compression (#1160)', () => {
  // Pulling the middle row of a 3×3 grid down squashes the bottom cells to
  // a tenth of their height and stretches the top ones to nearly twice.
  // The damped fixed-point inverse missed by up to 0.04 of the document
  // there, which broke thin horizontal lines into dashes.
  const grid = [3, 4, 5].reduce((g, idx) => dragPoint(g, idx, 0, 0.45), createIdentityGrid(3, 3));
  const data = encodeGridToRgba(grid);

  it('finds the exact source for every output pixel', () => {
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      for (let j = 0; j <= 100; j++) {
        const uv = { x: i / 100, y: j / 100 };
        const src = shaderSourceUv(data, 3, 3, uv);
        worst = Math.max(worst, Math.sqrt(norm2(residual(data, 3, 3, src, uv))));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('keeps a thin horizontal line in the squashed band unbroken', () => {
    // The source row y = 0.75 lands at 0.95 + 0.25 * 0.1 = 0.975 after the
    // drag; every output pixel along it must map back to that row. The 10x
    // squash magnifies the 1/32767 encoding step, hence 1e-4 (0.08 px on an
    // 800 px tall document) rather than the solver's own precision.
    const outY = 0.975;
    for (let i = 0; i <= 200; i++) {
      const src = shaderSourceUv(data, 3, 3, { x: i / 200, y: outY });
      expect(Math.abs(src.y - 0.75)).toBeLessThan(1e-4);
    }
  });

  it('inverts a cell stretched past 4x, where damped steps diverged', () => {
    // 6×6 grid, rows at 0, 0.2, …, 1. Rows 1–4 move to 0.05, 0.1, 0.95 and
    // 0.975: the cell between rows 2 and 3 grows from 0.2 to 0.85 tall and
    // every other cell shrinks, without any folding.
    const rowOffsets = [0, -0.15, -0.3, 0.35, 0.175, 0];
    let stretched = createIdentityGrid(6, 6);
    rowOffsets.forEach((dy, row) => {
      for (let col = 0; col < 6; col++) stretched = dragPoint(stretched, row * 6 + col, 0, dy);
    });
    const sData = encodeGridToRgba(stretched);
    let worst = 0;
    for (let i = 0; i <= 50; i++) {
      for (let j = 0; j <= 50; j++) {
        const uv = { x: i / 50, y: j / 50 };
        const src = shaderSourceUv(sData, 6, 6, uv);
        worst = Math.max(worst, Math.sqrt(norm2(residual(sData, 6, 6, src, uv))));
      }
    }
    expect(worst).toBeLessThan(1e-6);
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
    const d = gridPoint(encodeGridToRgba(grid), handleIdx);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBe(0);
  });

  it('moves the content under a handle to where the handle was dragged', () => {
    const d = { x: 0.1, y: -0.05 };
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, d.x, d.y);
    const data = encodeGridToRgba(grid);
    const dragged = { x: origin.x + d.x, y: origin.y + d.y };
    const src = shaderSourceUv(data, cols, rows, dragged);
    expect(Math.abs(src.x - origin.x)).toBeLessThan(1 / 32767);
    expect(Math.abs(src.y - origin.y)).toBeLessThan(1 / 32767);
  });

  it('samples content from behind the drag, not ahead of it', () => {
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, 0.1, 0);
    const data = encodeGridToRgba(grid);
    const src = shaderSourceUv(data, cols, rows, origin);
    expect(src.x).toBeLessThan(origin.x);
  });

  it('follows a leftward drag too', () => {
    const d = -0.15;
    const grid = dragPoint(createIdentityGrid(cols, rows), handleIdx, d, 0);
    const data = encodeGridToRgba(grid);
    const src = shaderSourceUv(data, cols, rows, { x: origin.x + d, y: origin.y });
    expect(Math.abs(src.x - origin.x)).toBeLessThan(1 / 32767);
  });
});
