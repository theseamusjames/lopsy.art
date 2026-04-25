import { filterMeshWarp } from '../engine-wasm/wasm-bridge';
import type { Engine } from '../engine-wasm/wasm-bridge';

export interface MeshWarpGrid {
  cols: number;
  rows: number;
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

export function encodeGridToRgba(grid: MeshWarpGrid): Uint8Array {
  const { cols, rows, points } = grid;
  const data = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const point = points[idx]!;
      const origX = c / (cols - 1);
      const origY = r / (rows - 1);
      const dx = point.x - origX;
      const dy = point.y - origY;
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

export function applyMeshWarpGpu(engine: Engine, layerId: string, grid: MeshWarpGrid): void {
  const data = encodeGridToRgba(grid);
  filterMeshWarp(engine, layerId, data, grid.cols, grid.rows);
}
