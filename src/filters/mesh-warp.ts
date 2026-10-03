import { filterMeshWarp } from '../engine-wasm/wasm-bridge';
import type { Engine } from '../engine-wasm/wasm-bridge';
import type { Rect } from '../types';

export interface MeshWarpGrid {
  cols: number;
  rows: number;
  /**
   * Grid points in normalised 0..1 coordinates within the warp bounds.
   * Identity = each point at (c/(cols-1), r/(rows-1)).
   */
  points: { x: number; y: number }[];
}

export function createIdentityGrid(cols: number, rows: number): MeshWarpGrid {
  const points: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ x: c / (cols - 1), y: r / (rows - 1) });
    }
  }
  return { cols, rows, points };
}

/**
 * 16-bit code that decodes to exactly zero displacement. `mesh_warp.glsl`
 * decodes `(code - DISPLACEMENT_CENTER) / DISPLACEMENT_SCALE`, so these
 * constants must stay in sync with the shader. The zero must be
 * representable or untouched grid points drift content (#909).
 *
 * Displacements are in bounds-local units (a point never leaves the bounds,
 * so they span -1..1) at 16 bits each: one step is 1/32767 of the warp
 * bounds. A single byte per axis moved content in steps of 1/127 of the
 * bounds — 19 px on a 2400 px wide document (#1160).
 */
export const DISPLACEMENT_CENTER = 32768;
export const DISPLACEMENT_SCALE = 32767;

export function encodeDisplacement(d: number): number {
  // Round half away from zero so +d and -d encode symmetrically
  // (Math.round alone rounds halves toward +Infinity).
  const steps = Math.sign(d) * Math.round(Math.abs(d) * DISPLACEMENT_SCALE);
  const encoded = steps + DISPLACEMENT_CENTER;
  return Math.max(DISPLACEMENT_CENTER - DISPLACEMENT_SCALE, Math.min(DISPLACEMENT_CENTER + DISPLACEMENT_SCALE, encoded));
}

export function decodeDisplacement(code: number): number {
  return (code - DISPLACEMENT_CENTER) / DISPLACEMENT_SCALE;
}

/**
 * Encode the grid as forward displacements in bounds-local units: content
 * at a point's identity position moves by that offset so it follows the
 * dragged handle. Each texel holds one point: (R, G) are the high and low
 * bytes of the X code, (B, A) those of the Y code.
 */
export function encodeGridToRgba(grid: MeshWarpGrid): Uint8Array {
  const { cols, rows, points } = grid;
  const data = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const point = points[idx]!;
      const codeX = encodeDisplacement(point.x - c / (cols - 1));
      const codeY = encodeDisplacement(point.y - r / (rows - 1));
      const pi = idx * 4;
      data[pi] = codeX >> 8;
      data[pi + 1] = codeX & 0xff;
      data[pi + 2] = codeY >> 8;
      data[pi + 3] = codeY & 0xff;
    }
  }
  return data;
}

/**
 * Apply mesh warp to a layer over a sub-rectangle.
 *
 * `bounds` is the document-space rect the grid covers. Pixels outside the
 * rect pass through unchanged. When `bounds` equals the document, the warp
 * covers the full image.
 */
export function applyMeshWarpGpu(
  engine: Engine,
  layerId: string,
  grid: MeshWarpGrid,
  bounds: Rect,
  docW: number,
  docH: number,
): void {
  const minU = bounds.x / docW;
  const minV = bounds.y / docH;
  const maxU = (bounds.x + bounds.width) / docW;
  const maxV = (bounds.y + bounds.height) / docH;
  const data = encodeGridToRgba(grid);
  filterMeshWarp(engine, layerId, data, grid.cols, grid.rows, minU, minV, maxU, maxV);
}
