import type { Rect } from '../types';
import { squaredDistanceTransform, DISTANCE_INFINITY } from './distance-transform';

interface SelectionMask {
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

/**
 * Look up a selection mask value in document/canvas space,
 * returning 0 for any out-of-bounds coordinate or null mask.
 */
export function getSelectionMaskValue(
  sel: SelectionMask,
  canvasX: number,
  canvasY: number,
): number {
  if (!sel.mask) return 0;
  if (canvasX < 0 || canvasX >= sel.maskWidth || canvasY < 0 || canvasY >= sel.maskHeight) return 0;
  return sel.mask[canvasY * sel.maskWidth + canvasX] ?? 0;
}

export function createRectSelection(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(canvasWidth * canvasHeight);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      mask[y * canvasWidth + x] = 255;
    }
  }
  return mask;
}

export function createEllipseSelection(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(canvasWidth * canvasHeight);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;

  if (rx <= 0 || ry <= 0) return mask;

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        mask[y * canvasWidth + x] = 255;
      }
    }
  }
  return mask;
}

export function invertSelection(mask: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = 255 - (mask[i] ?? 0);
  }
  return result;
}

export type SelectionCombineOp = 'add' | 'subtract' | 'intersect';
export type SelectionCombineMode = 'replace' | SelectionCombineOp;

/**
 * How a selection gesture combines with the selection already on the
 * canvas, read from the modifiers held when it starts: Shift adds, Alt
 * subtracts, both together intersect. With nothing selected there is
 * nothing to combine with, so every gesture starts a new selection.
 */
export function selectionCombineMode(
  modifiers: { shiftKey: boolean; altKey: boolean },
  hasSelection: boolean,
): SelectionCombineMode {
  if (!hasSelection) return 'replace';
  if (modifiers.shiftKey && modifiers.altKey) return 'intersect';
  if (modifiers.shiftKey) return 'add';
  if (modifiers.altKey) return 'subtract';
  return 'replace';
}

export const SELECTION_COMBINE_LABELS: Readonly<Record<SelectionCombineOp, string>> = {
  add: 'Add to Selection',
  subtract: 'Subtract from Selection',
  intersect: 'Intersect Selection',
};

/**
 * `add` sums coverage (clamped) rather than taking the max so two
 * anti-aliased shapes that share an edge — adjacent lasso triangles —
 * sum to full coverage along it instead of leaving a half-transparent seam.
 */
export function combineSelections(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  mode: SelectionCombineOp,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    switch (mode) {
      case 'add':
        result[i] = Math.min(255, av + bv);
        break;
      case 'subtract':
        result[i] = Math.max(0, av - bv);
        break;
      case 'intersect':
        result[i] = Math.min(av, bv);
        break;
    }
  }
  return result;
}

export function selectionBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((mask[y * width + x] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function isEmptySelection(mask: Uint8ClampedArray): boolean {
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Move a selection mask by (dx, dy). Only `region` (the old bounds) holds
 * content, so only it is walked. Whatever leaves the document is dropped,
 * and the returned bounds cover only what stays on it (#1188): bounds
 * shifted as a whole hung off the canvas, so Copy and Crop worked on a
 * rectangle the size of the old one.
 */
export function translateSelectionMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  region: Rect,
  dx: number,
  dy: number,
): { mask: Uint8ClampedArray; bounds: Rect | null } {
  const out = new Uint8ClampedArray(mask.length);
  const rx0 = Math.max(0, Math.floor(region.x));
  const ry0 = Math.max(0, Math.floor(region.y));
  const rx1 = Math.min(width, Math.ceil(region.x + region.width));
  const ry1 = Math.min(height, Math.ceil(region.y + region.height));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let sy = ry0; sy < ry1; sy++) {
    const ty = sy + dy;
    if (ty < 0 || ty >= height) continue;
    for (let sx = rx0; sx < rx1; sx++) {
      const v = mask[sy * width + sx] ?? 0;
      if (v === 0) continue;
      const tx = sx + dx;
      if (tx < 0 || tx >= width) continue;
      out[ty * width + tx] = v;
      if (tx < minX) minX = tx;
      if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty;
      if (ty > maxY) maxY = ty;
    }
  }
  if (maxX < 0) return { mask: out, bounds: null };
  return { mask: out, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}

/** A mask value at or above this counts as inside the selection edge. */
const EDGE_THRESHOLD = 128;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Squared distance from every cell of `region` (document space, may extend
 * past the document) to the nearest cell whose inside-ness equals
 * `targetInside`. Cells outside the document count as outside the selection.
 */
function regionDistances(
  mask: Uint8ClampedArray,
  docWidth: number,
  docHeight: number,
  region: Region,
  targetInside: boolean,
): Float32Array {
  const grid = new Float32Array(region.width * region.height);
  for (let ry = 0; ry < region.height; ry++) {
    const y = region.y + ry;
    for (let rx = 0; rx < region.width; rx++) {
      const x = region.x + rx;
      const isOnDoc = x >= 0 && x < docWidth && y >= 0 && y < docHeight;
      const isInside = isOnDoc && (mask[y * docWidth + x] ?? 0) >= EDGE_THRESHOLD;
      grid[ry * region.width + rx] = isInside === targetInside ? 0 : DISTANCE_INFINITY;
    }
  }
  squaredDistanceTransform(grid, region.width, region.height);
  return grid;
}

/**
 * Coverage of a pixel whose centre sits `signedDistance` px inside an edge
 * (negative = outside); a centre exactly on the edge is 50% covered.
 */
function edgeCoverage(signedDistance: number): number {
  return Math.min(1, Math.max(0, signedDistance + 0.5));
}

/**
 * Expand the selection by `amount` px, measured with a Euclidean distance
 * transform from the 50% coverage edge so curves stay round (#1038).
 */
export function growSelection(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray {
  const bounds = amount > 0 ? selectionBounds(mask, width, height) : null;
  if (!bounds) return new Uint8ClampedArray(mask);

  const pad = Math.ceil(amount) + 1;
  const x0 = Math.max(0, bounds.x - pad);
  const y0 = Math.max(0, bounds.y - pad);
  const x1 = Math.min(width, bounds.x + bounds.width + pad);
  const y1 = Math.min(height, bounds.y + bounds.height + pad);
  const region = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const dist = regionDistances(mask, width, height, region, true);

  const result = new Uint8ClampedArray(mask);
  for (let ry = 0; ry < region.height; ry++) {
    for (let rx = 0; rx < region.width; rx++) {
      const idx = (region.y + ry) * width + region.x + rx;
      const d = Math.sqrt(dist[ry * region.width + rx]!);
      // The old edge lies half-way to the nearest inside centre. Inside
      // pixels (d = 0) are at least `amount` + 0.5 from the new edge, so
      // their partial anti-aliased coverage must be raised too (#1189).
      const coverage = Math.round(edgeCoverage(amount - (d - 0.5)) * 255);
      if (coverage > result[idx]!) result[idx] = coverage;
    }
  }
  return result;
}

/**
 * Contract the selection by `amount` px, measured with a Euclidean distance
 * transform from the 50% coverage edge so curves stay round (#1038). The
 * document edge counts as a selection edge.
 */
export function shrinkSelection(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray {
  const bounds = amount > 0 ? selectionBounds(mask, width, height) : null;
  if (!bounds) return new Uint8ClampedArray(mask);

  const region = {
    x: bounds.x - 1,
    y: bounds.y - 1,
    width: bounds.width + 2,
    height: bounds.height + 2,
  };
  const dist = regionDistances(mask, width, height, region, false);

  const result = new Uint8ClampedArray(mask.length);
  for (let ry = 1; ry < region.height - 1; ry++) {
    for (let rx = 1; rx < region.width - 1; rx++) {
      const x = region.x + rx;
      const y = region.y + ry;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const idx = y * width + x;
      const d = Math.sqrt(dist[ry * region.width + rx]!);
      if (d === 0) continue;
      const coverage = Math.round(edgeCoverage(d - 0.5 - amount) * 255);
      result[idx] = Math.min(mask[idx]!, coverage);
    }
  }
  return result;
}

/**
 * Feather a selection mask by applying a separable Gaussian approximation
 * (three passes of box blur) to the mask values.
 * radius is in pixels; larger values produce softer edges.
 */
export function featherSelection(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask);

  // Three-pass box blur approximates a Gaussian. Box kernel half-width derived
  // from the target standard deviation: sigma ≈ radius/2, box_r ≈ sigma.
  const boxR = Math.max(1, Math.round(radius / 2));

  let src = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    src[i] = (mask[i] ?? 0) / 255;
  }

  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(width * height);
    // Horizontal pass
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      for (let x = 0; x < Math.min(boxR, width); x++) {
        sum += src[y * width + x]!;
        count++;
      }
      for (let x = 0; x < width; x++) {
        if (x + boxR < width) {
          sum += src[y * width + x + boxR]!;
          count++;
        }
        if (x - boxR - 1 >= 0) {
          sum -= src[y * width + x - boxR - 1]!;
          count--;
        }
        tmp[y * width + x] = sum / count;
      }
    }
    const tmp2 = new Float32Array(width * height);
    // Vertical pass
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < Math.min(boxR, height); y++) {
        sum += tmp[y * width + x]!;
        count++;
      }
      for (let y = 0; y < height; y++) {
        if (y + boxR < height) {
          sum += tmp[(y + boxR) * width + x]!;
          count++;
        }
        if (y - boxR - 1 >= 0) {
          sum -= tmp[(y - boxR - 1) * width + x]!;
          count--;
        }
        tmp2[y * width + x] = sum / count;
      }
    }
    src = tmp2;
  }

  const result = new Uint8ClampedArray(width * height);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.round(Math.min(1, Math.max(0, src[i]!)) * 255);
  }
  return result;
}

/**
 * Extract edge segments from a selection mask for marching ants rendering.
 * Returns arrays of horizontal and vertical line segments at pixel boundaries
 * where selected pixels border unselected pixels.
 */
export function getSelectionEdges(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  scanBounds?: Rect | null,
): { h: Float64Array; v: Float64Array } {
  const threshold = 128;
  const hSegments: number[] = [];
  const vSegments: number[] = [];

  // Limit the edge scan to the selection's bounding box (expanded one pixel
  // so border pixels still see their unselected neighbour). The mask is zero
  // outside its content bounds, so scanning a superset region yields
  // identical edges at a fraction of the cost — without this, a live marquee
  // drag re-scans the entire canvas every frame and collapses to <1fps on
  // large documents.
  const sx0 = scanBounds ? Math.max(0, Math.floor(scanBounds.x) - 1) : 0;
  const sy0 = scanBounds ? Math.max(0, Math.floor(scanBounds.y) - 1) : 0;
  const sx1 = scanBounds ? Math.min(maskWidth, Math.ceil(scanBounds.x + scanBounds.width) + 1) : maskWidth;
  const sy1 = scanBounds ? Math.min(maskHeight, Math.ceil(scanBounds.y + scanBounds.height) + 1) : maskHeight;

  // Horizontal edges: scan row by row, merge adjacent segments on the same Y
  for (let y = sy0; y < sy1; y++) {
    let topStart = -1;
    let botStart = -1;
    for (let x = sx0; x <= sx1; x++) {
      const selected = x < sx1 && (mask[y * maskWidth + x] ?? 0) >= threshold;
      const isTopEdge = selected && (y === 0 || (mask[(y - 1) * maskWidth + x] ?? 0) < threshold);
      const isBotEdge = selected && (y === maskHeight - 1 || (mask[(y + 1) * maskWidth + x] ?? 0) < threshold);

      if (isTopEdge) {
        if (topStart < 0) topStart = x;
      } else {
        if (topStart >= 0) {
          hSegments.push(topStart, y, x, y);
          topStart = -1;
        }
      }
      if (isBotEdge) {
        if (botStart < 0) botStart = x;
      } else {
        if (botStart >= 0) {
          hSegments.push(botStart, y + 1, x, y + 1);
          botStart = -1;
        }
      }
    }
  }

  // Vertical edges: scan column by column, merge adjacent segments on the same X
  for (let x = sx0; x < sx1; x++) {
    let leftStart = -1;
    let rightStart = -1;
    for (let y = sy0; y <= sy1; y++) {
      const selected = y < sy1 && (mask[y * maskWidth + x] ?? 0) >= threshold;
      const isLeftEdge = selected && (x === 0 || (mask[y * maskWidth + x - 1] ?? 0) < threshold);
      const isRightEdge = selected && (x === maskWidth - 1 || (mask[y * maskWidth + x + 1] ?? 0) < threshold);

      if (isLeftEdge) {
        if (leftStart < 0) leftStart = y;
      } else {
        if (leftStart >= 0) {
          vSegments.push(x, leftStart, x, y);
          leftStart = -1;
        }
      }
      if (isRightEdge) {
        if (rightStart < 0) rightStart = y;
      } else {
        if (rightStart >= 0) {
          vSegments.push(x + 1, rightStart, x + 1, y);
          rightStart = -1;
        }
      }
    }
  }

  return { h: new Float64Array(hSegments), v: new Float64Array(vSegments) };
}

/**
 * Trace selection edge segments into connected contour polylines.
 * Each contour is a flat array of [x0, y0, x1, y1, ...] coordinates.
 * Segments that share endpoints are chained so the canvas dash pattern
 * flows continuously around each contour instead of restarting per segment.
 */
export function traceSelectionContours(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  scanBounds?: Rect | null,
): number[][] {
  const edges = getSelectionEdges(mask, maskWidth, maskHeight, scanBounds);

  // Collect all segments
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < edges.h.length; i += 4) {
    segs.push([edges.h[i]!, edges.h[i + 1]!, edges.h[i + 2]!, edges.h[i + 3]!]);
  }
  for (let i = 0; i < edges.v.length; i += 4) {
    segs.push([edges.v[i]!, edges.v[i + 1]!, edges.v[i + 2]!, edges.v[i + 3]!]);
  }

  if (segs.length === 0) return [];

  // Build endpoint → segment indices map
  const endMap = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = endMap.get(k);
      if (list) list.push(i);
      else endMap.set(k, [i]);
    }
  }

  // Walk connected segments into contours
  const visited = new Uint8Array(segs.length);
  const contours: number[][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const s = segs[i]!;
    const pts: number[] = [s[0], s[1], s[2], s[3]];
    let tailKey = key(s[2], s[3]);

    // Walk forward from tail
    for (;;) {
      const neighbors = endMap.get(tailKey);
      if (!neighbors) break;
      let found = false;
      for (const ni of neighbors) {
        if (visited[ni]) continue;
        visited[ni] = 1;
        const ns = segs[ni]!;
        const k0 = key(ns[0], ns[1]);
        if (k0 === tailKey) {
          pts.push(ns[2], ns[3]);
          tailKey = key(ns[2], ns[3]);
        } else {
          pts.push(ns[0], ns[1]);
          tailKey = key(ns[0], ns[1]);
        }
        found = true;
        break;
      }
      if (!found) break;
    }

    contours.push(pts);
  }

  return contours;
}
