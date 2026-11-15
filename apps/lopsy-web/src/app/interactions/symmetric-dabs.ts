import type { Engine } from '../../engine-wasm/wasm-bridge';
import {
  applyBrushDab,
  applyBrushDabBatch,
  setBrushDabTransform,
} from '../../engine-wasm/wasm-bridge';
import type { SymmetryConfig } from '../../tools/symmetry';
import {
  dabSampleMatrix,
  getMirroredPoints,
  getSymmetryMatrices,
  isSymmetryActive,
  mirrorBatchPoints,
} from '../../tools/symmetry';

/** Per-dab brush parameters shared by the primary stroke and every copy. */
export interface BrushDabParams {
  readonly size: number;
  readonly hardness: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly opacity: number;
  readonly flow: number;
  readonly sizeJitter: number;
  readonly angleJitter: number;
  readonly opacityJitter: number;
}

function resetTransform(engine: Engine): void {
  setBrushDabTransform(engine, 1, 0, 0, 1);
}

/**
 * Stamp a batch of brush dabs plus their symmetry copies. Each copy's tip
 * is reflected or rotated with its position, so an oriented tip (a
 * calligraphic nib, a leaf) comes out as a true mirror image instead of
 * the same tip translated.
 */
export function brushDabBatchSymmetric(
  engine: Engine,
  layerId: string,
  pts: Float64Array,
  sym: SymmetryConfig,
  p: BrushDabParams,
): void {
  applyBrushDabBatch(engine, layerId, pts, p.size, p.hardness, p.r, p.g, p.b, p.a, p.opacity, p.flow, p.sizeJitter, p.angleJitter, p.opacityJitter);
  if (!isSymmetryActive(sym)) return;
  const copies = mirrorBatchPoints(pts, sym);
  const matrices = getSymmetryMatrices(sym);
  for (let i = 0; i < copies.length; i++) {
    const m = dabSampleMatrix(matrices[i]!);
    setBrushDabTransform(engine, m.m00, m.m01, m.m10, m.m11);
    applyBrushDabBatch(engine, layerId, copies[i]!, p.size, p.hardness, p.r, p.g, p.b, p.a, p.opacity, p.flow, p.sizeJitter, p.angleJitter, p.opacityJitter);
  }
  resetTransform(engine);
}

/** Single-dab counterpart of `brushDabBatchSymmetric`. */
export function brushDabSymmetric(
  engine: Engine,
  layerId: string,
  x: number,
  y: number,
  sym: SymmetryConfig,
  p: BrushDabParams,
): void {
  applyBrushDab(engine, layerId, x, y, p.size, p.hardness, p.r, p.g, p.b, p.a, p.opacity, p.flow, p.sizeJitter, p.angleJitter, p.opacityJitter);
  if (!isSymmetryActive(sym)) return;
  const copies = getMirroredPoints(x, y, sym);
  const matrices = getSymmetryMatrices(sym);
  for (let i = 0; i < copies.length; i++) {
    const m = dabSampleMatrix(matrices[i]!);
    setBrushDabTransform(engine, m.m00, m.m01, m.m10, m.m11);
    applyBrushDab(engine, layerId, copies[i]!.x, copies[i]!.y, p.size, p.hardness, p.r, p.g, p.b, p.a, p.opacity, p.flow, p.sizeJitter, p.angleJitter, p.opacityJitter);
  }
  resetTransform(engine);
}
