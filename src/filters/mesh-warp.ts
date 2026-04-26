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
 * Encode the grid as displacements in texture UV space.
 * Each point's offset from its identity position is scaled by the bounds
 * size (in texture UV) so the GPU shader applies the right v_uv displacement.
 */
export function encodeGridToRgba(grid: MeshWarpGrid, boundsScaleU: number, boundsScaleV: number): Uint8Array {
  const { cols, rows, points } = grid;
  const data = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const point = points[idx]!;
      const origX = c / (cols - 1);
      const origY = r / (rows - 1);
      const dxLocal = point.x - origX;
      const dyLocal = point.y - origY;
      const dx = dxLocal * boundsScaleU;
      const dy = dyLocal * boundsScaleV;
      const encodedX = Math.round((dx / 2.0 + 0.5) * 255);
      const encodedY = Math.round((dy / 2.0 + 0.5) * 255);
      const pi = idx * 4;
      data[pi] = Math.max(0, Math.min(255, encodedX));
      data[pi + 1] = Math.max(0, Math.min(255, encodedY));
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
