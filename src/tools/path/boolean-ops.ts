import type { PathAnchor } from './path';
import type { Point } from '../../types';
import { selectionToPaths } from '../../selection/selection-to-path';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

// ---------------------------------------------------------------------------
// Bezier flattening
// ---------------------------------------------------------------------------

/** Adaptively flatten a cubic Bezier segment to a polyline. */
function flattenSegment(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  out: Point[],
  tolerance = 0.5,
): void {
  // Flatness test: max distance of control points from the chord.
  const ux = 3 * cp1.x - 2 * p0.x - p3.x;
  const uy = 3 * cp1.y - 2 * p0.y - p3.y;
  const vx = 3 * cp2.x - 2 * p3.x - p0.x;
  const vy = 3 * cp2.y - 2 * p3.y - p0.y;
  const flatness = Math.max(ux * ux + uy * uy, vx * vx + vy * vy);
  if (flatness <= tolerance * tolerance * 16) {
    out.push(p3);
    return;
  }
  // De Casteljau split at t=0.5
  const mx01x = (p0.x + cp1.x) * 0.5;
  const mx01y = (p0.y + cp1.y) * 0.5;
  const mx12x = (cp1.x + cp2.x) * 0.5;
  const mx12y = (cp1.y + cp2.y) * 0.5;
  const mx23x = (cp2.x + p3.x) * 0.5;
  const mx23y = (cp2.y + p3.y) * 0.5;
  const mx012x = (mx01x + mx12x) * 0.5;
  const mx012y = (mx01y + mx12y) * 0.5;
  const mx123x = (mx12x + mx23x) * 0.5;
  const mx123y = (mx12y + mx23y) * 0.5;
  const midx = (mx012x + mx123x) * 0.5;
  const midy = (mx012y + mx123y) * 0.5;
  const mid: Point = { x: midx, y: midy };
  flattenSegment(p0, { x: mx01x, y: mx01y }, { x: mx012x, y: mx012y }, mid, out, tolerance);
  flattenSegment(mid, { x: mx123x, y: mx123y }, { x: mx23x, y: mx23y }, p3, out, tolerance);
}

/** Convert a closed path (PathAnchor[]) to a flat polygon (Point[]). */
function pathToPolygon(anchors: readonly PathAnchor[]): Point[] {
  if (anchors.length < 2) return anchors.map((a) => ({ ...a.point }));
  const poly: Point[] = [{ ...anchors[0]!.point }];
  const count = anchors.length;
  for (let i = 0; i < count; i++) {
    const a = anchors[i]!;
    const b = anchors[(i + 1) % count]!;
    const cp1 = a.handleOut ?? a.point;
    const cp2 = b.handleIn ?? b.point;
    flattenSegment(a.point, cp1, cp2, b.point, poly);
  }
  // Remove duplicate closing point if present
  const last = poly[poly.length - 1];
  const first = poly[0];
  if (last && first && Math.abs(last.x - first.x) < 0.5 && Math.abs(last.y - first.y) < 0.5) {
    poly.pop();
  }
  return poly;
}

// ---------------------------------------------------------------------------
// Polygon bounds
// ---------------------------------------------------------------------------

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function polygonBounds(poly: Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Raster-based boolean operation
// Uses an off-screen canvas to rasterize polygons, performs pixel-wise
// boolean ops on the masks, then traces the result contour.
// ---------------------------------------------------------------------------

/** @internal exported for tests */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Rasterize a polygon to a 1-byte-per-pixel mask (255 inside, 0 outside). */
function rasterizePolygon(
  poly: Point[],
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || poly.length < 2) return new Uint8ClampedArray(width * height);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(poly[0]!.x - offsetX, poly[0]!.y - offsetY);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i]!.x - offsetX, poly[i]!.y - offsetY);
  }
  ctx.closePath();
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, width, height);
  // Extract alpha channel into a flat byte array (1 byte per pixel)
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (imageData.data[i * 4 + 3] ?? 0) > 128 ? 255 : 0;
  }
  return mask;
}

/** Pixel-wise boolean combination of two masks.
 * @internal exported for tests
 */
export function combineMasks(
  maskA: Uint8ClampedArray,
  maskB: Uint8ClampedArray,
  op: BooleanOp,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(maskA.length);
  for (let i = 0; i < maskA.length; i++) {
    const a = maskA[i] ?? 0;
    const b = maskB[i] ?? 0;
    switch (op) {
      case 'union':    result[i] = (a | b);     break;
      case 'subtract': result[i] = (a & ~b);    break;
      case 'intersect':result[i] = (a & b);     break;
      case 'exclude':  result[i] = (a ^ b);     break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mask → paths
// ---------------------------------------------------------------------------

/**
 * Trace every contour of a combined 0/255 mask (outer boundaries, holes and
 * separate islands) and fit each with the corner-aware fitter Selection →
 * Path uses, translated back to document space by (offsetX, offsetY).
 * Keeping only the longest contour dropped holes and islands (#1332), and
 * the old Catmull-Rom fitter attached handles to the wrong anchors, looping
 * every straight edge (#1331).
 * @internal exported for tests
 */
export function maskToPaths(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): PathAnchor[][] {
  return selectionToPaths(mask, width, height).map((anchors) =>
    anchors.map((a) => ({
      point: offsetPoint(a.point, offsetX, offsetY),
      handleIn: a.handleIn ? offsetPoint(a.handleIn, offsetX, offsetY) : null,
      handleOut: a.handleOut ? offsetPoint(a.handleOut, offsetX, offsetY) : null,
    })),
  );
}

function offsetPoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BooleanOpResult {
  /**
   * One closed anchor list per contour of the result — the outer boundary,
   * each hole, and each separate island — ordered top-to-bottom. Empty if
   * no area.
   */
  paths: PathAnchor[][];
  /** True if the result has meaningful area (non-empty). */
  hasArea: boolean;
}

/**
 * Perform a boolean operation between two closed paths.
 * Both paths must be closed. The result is always a closed path.
 *
 * Raster-based implementation:
 * 1. Flatten both paths to polygons
 * 2. Rasterize to masks on a temporary canvas
 * 3. Combine masks pixel-wise
 * 4. Trace every contour and fit bezier anchors to each
 */
export function booleanOp(
  pathA: { anchors: readonly PathAnchor[]; closed: boolean },
  pathB: { anchors: readonly PathAnchor[]; closed: boolean },
  op: BooleanOp,
): BooleanOpResult {
  const polyA = pathToPolygon(pathA.anchors);
  const polyB = pathToPolygon(pathB.anchors);

  if (polyA.length < 2 || polyB.length < 2) {
    return { paths: [], hasArea: false };
  }

  const boundsA = polygonBounds(polyA);
  const boundsB = polygonBounds(polyB);
  const bounds = unionBounds(boundsA, boundsB);

  // Pad by a couple of pixels to avoid edge clipping
  const pad = 2;
  const offsetX = Math.floor(bounds.minX) - pad;
  const offsetY = Math.floor(bounds.minY) - pad;
  const width = Math.ceil(bounds.maxX - bounds.minX) + pad * 2 + 1;
  const height = Math.ceil(bounds.maxY - bounds.minY) + pad * 2 + 1;

  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    return { paths: [], hasArea: false };
  }

  const maskA = rasterizePolygon(polyA, offsetX, offsetY, width, height);
  const maskB = rasterizePolygon(polyB, offsetX, offsetY, width, height);
  const combined = combineMasks(maskA, maskB, op);

  // Check if result has any filled pixels
  let hasArea = false;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i]! > 0) { hasArea = true; break; }
  }
  if (!hasArea) return { paths: [], hasArea: false };

  const paths = maskToPaths(combined, width, height, offsetX, offsetY);
  if (paths.length === 0) return { paths: [], hasArea: false };
  return { paths, hasArea: true };
}
