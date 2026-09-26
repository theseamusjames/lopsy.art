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
 * Byte that decodes to exactly zero displacement. `mesh_warp.glsl` decodes
 * `(byte - DISPLACEMENT_CENTER) / DISPLACEMENT_SCALE`, so these constants
 * must stay in sync with the shader. A centre of 127.5 (the naive
 * `(d / 2 + 0.5) * 255`) is not representable and made untouched grid
 * points drift content by half a step (#909).
 */
export const DISPLACEMENT_CENTER = 128;
export const DISPLACEMENT_SCALE = 127;

export function encodeDisplacement(d: number): number {
  // Round half away from zero so +d and -d encode symmetrically
  // (Math.round alone rounds halves toward +Infinity).
  const steps = Math.sign(d) * Math.round(Math.abs(d) * DISPLACEMENT_SCALE);
  const encoded = steps + DISPLACEMENT_CENTER;
  return Math.max(DISPLACEMENT_CENTER - DISPLACEMENT_SCALE, Math.min(DISPLACEMENT_CENTER + DISPLACEMENT_SCALE, encoded));
}

export function decodeDisplacement(byte: number): number {
  return (byte - DISPLACEMENT_CENTER) / DISPLACEMENT_SCALE;
}

/**
 * Encode the grid as forward displacements in texture UV space: content
 * at a point's identity position moves by (R, G) so it follows the
 * dragged handle. Each point's offset from its identity position is
 * scaled by the bounds size (in texture UV).
 */
export function encodeGridToRgba(grid: MeshWarpGrid, boundsScaleU: number, boundsScaleV: number): Uint8Array {
  const { cols, rows, points } = grid;
  const data = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const point = points[idx]!;
      const dx = (point.x - c / (cols - 1)) * boundsScaleU;
      const dy = (point.y - r / (rows - 1)) * boundsScaleV;
      const pi = idx * 4;
      data[pi] = encodeDisplacement(dx);
      data[pi + 1] = encodeDisplacement(dy);
      data[pi + 2] = 0;
      data[pi + 3] = 255;
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
  const scaleU = maxU - minU;
  const scaleV = maxV - minV;
  const data = encodeGridToRgba(grid, scaleU, scaleV);
  filterMeshWarp(engine, layerId, data, grid.cols, grid.rows, minU, minV, maxU, maxV);
}
