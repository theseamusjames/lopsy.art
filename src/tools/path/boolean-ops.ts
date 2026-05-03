import type { PathAnchor } from './path';
import type { Point } from '../../types';

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

/** Rasterize a polygon to a binary ImageData (alpha = 255 inside, 0 outside). */
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
    mask[i] = (imageData.data[i * 4 + 3] ?? 0) > 128 ? 1 : 0;
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
// Marching squares contour tracing
// ---------------------------------------------------------------------------

type Cell = 0 | 1;

function getCell(mask: Uint8ClampedArray, width: number, x: number, y: number): Cell {
  if (x < 0 || y < 0 || x >= width || y >= mask.length / width) return 0;
  return (mask[y * width + x] ?? 0) > 0 ? 1 : 0;
}

/** Return all contour edge midpoints as a list of polygons (each polygon is a Point[]).
 * @internal exported for tests
 */
export function traceContours(mask: Uint8ClampedArray, width: number, height: number): Point[][] {
  // Build an edge graph: map from "x,y" string key to adjacent midpoints
  const edges = new Map<string, Point[]>();
  const key = (p: Point) => `${p.x},${p.y}`;

  function addEdge(a: Point, b: Point): void {
    const ka = key(a);
    const kb = key(b);
    if (!edges.has(ka)) edges.set(ka, []);
    if (!edges.has(kb)) edges.set(kb, []);
    edges.get(ka)!.push(b);
    edges.get(kb)!.push(a);
  }

  // Marching squares: iterate 2x2 cells of the mask
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = getCell(mask, width, x, y);
      const tr = getCell(mask, width, x + 1, y);
      const bl = getCell(mask, width, x, y + 1);
      const br = getCell(mask, width, x + 1, y + 1);
      const sq = tl * 8 + tr * 4 + br * 2 + bl;
      if (sq === 0 || sq === 15) continue;

      // Midpoints of the four cell edges
      const top:    Point = { x: x + 0.5, y };
      const right:  Point = { x: x + 1,   y: y + 0.5 };
      const bottom: Point = { x: x + 0.5, y: y + 1 };
      const left:   Point = { x,           y: y + 0.5 };

      switch (sq) {
        case 1:  addEdge(left, bottom);  break;
        case 2:  addEdge(right, bottom); break;
        case 3:  addEdge(left, right);   break;
        case 4:  addEdge(top, right);    break;
        case 5:  addEdge(top, left); addEdge(right, bottom); break;
        case 6:  addEdge(top, bottom);   break;
        case 7:  addEdge(top, left);     break;
        case 8:  addEdge(top, left);     break;
        case 9:  addEdge(top, bottom);   break;
        case 10: addEdge(top, right); addEdge(left, bottom); break;
        case 11: addEdge(top, right);    break;
        case 12: addEdge(left, right);   break;
        case 13: addEdge(right, bottom); break;
        case 14: addEdge(left, bottom);  break;
      }
    }
  }

  // Walk the edge graph to form polylines / polygons
  const visited = new Set<string>();
  const contours: Point[][] = [];

  for (const [startKey] of edges) {
    if (visited.has(startKey)) continue;
    const start = parsePoint(startKey);
    if (!start) continue;
    const contour: Point[] = [start];
    visited.add(startKey);

    let currentKey = startKey;
    let keepGoing = true;

    while (keepGoing) {
      keepGoing = false;
      const nexts = edges.get(currentKey) ?? [];
      for (const next of nexts) {
        const nk = key(next);
        if (!visited.has(nk)) {
          visited.add(nk);
          contour.push(next);
          currentKey = nk;
          keepGoing = true;
          break;
        }
      }
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

function parsePoint(k: string): Point | null {
  const parts = k.split(',');
  if (parts.length !== 2) return null;
  const x = parseFloat(parts[0] ?? '');
  const y = parseFloat(parts[1] ?? '');
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Simplify polyline (Ramer-Douglas-Peucker)
// ---------------------------------------------------------------------------

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i]!, points[0]!, points[last]!);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon);
    const right = rdp(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0]!, points[last]!];
}

// ---------------------------------------------------------------------------
// Convert polygon back to PathAnchor[] using Catmull-Rom → Bezier
// ---------------------------------------------------------------------------

function catmullRomToBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  alpha = 0.5,
): { cp1: Point; cp2: Point } {
  const t = alpha;
  const cp1: Point = {
    x: p1.x + (p2.x - p0.x) / 6 * t,
    y: p1.y + (p2.y - p0.y) / 6 * t,
  };
  const cp2: Point = {
    x: p2.x - (p3.x - p1.x) / 6 * t,
    y: p2.y - (p3.y - p1.y) / 6 * t,
  };
  return { cp1, cp2 };
}

function polygonToAnchors(poly: Point[]): PathAnchor[] {
  const n = poly.length;
  if (n === 0) return [];
  if (n === 1) return [{ point: poly[0]!, handleIn: null, handleOut: null }];

  // Build anchors with Catmull-Rom tangents
  const anchors: PathAnchor[] = poly.map((pt, i) => {
    const prev = poly[(i - 1 + n) % n]!;
    const next = poly[(i + 1) % n]!;
    const prev2 = poly[(i - 2 + n) % n]!;

    const { cp1: handleOut } = catmullRomToBezier(prev2, prev, pt, next, 1);
    const { cp2: handleIn } = catmullRomToBezier(prev, pt, next, poly[(i + 2) % n]!, 1);

    return { point: { ...pt }, handleIn, handleOut };
  });

  return anchors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BooleanOpResult {
  /** Resulting path anchors — always a closed path. Empty if no area. */
  anchors: PathAnchor[];
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
 * 4. Trace contours using marching squares
 * 5. Simplify contours and convert back to bezier anchors
 */
export function booleanOp(
  pathA: { anchors: readonly PathAnchor[]; closed: boolean },
  pathB: { anchors: readonly PathAnchor[]; closed: boolean },
  op: BooleanOp,
): BooleanOpResult {
  const polyA = pathToPolygon(pathA.anchors);
  const polyB = pathToPolygon(pathB.anchors);

  if (polyA.length < 2 || polyB.length < 2) {
    return { anchors: [], hasArea: false };
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
    return { anchors: [], hasArea: false };
  }

  const maskA = rasterizePolygon(polyA, offsetX, offsetY, width, height);
  const maskB = rasterizePolygon(polyB, offsetX, offsetY, width, height);
  const combined = combineMasks(maskA, maskB, op);

  // Check if result has any filled pixels
  let hasArea = false;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i]! > 0) { hasArea = true; break; }
  }
  if (!hasArea) return { anchors: [], hasArea: false };

  const contours = traceContours(combined, width, height);
  if (contours.length === 0) return { anchors: [], hasArea: false };

  // Take the longest contour (the outer boundary)
  contours.sort((a, b) => b.length - a.length);
  const mainContour = contours[0]!;

  // Translate back to document space
  const docContour: Point[] = mainContour.map((p) => ({
    x: p.x + offsetX,
    y: p.y + offsetY,
  }));

  // Simplify
  const simplified = rdp(docContour, 1.5);
  if (simplified.length < 3) return { anchors: [], hasArea: false };

  const anchors = polygonToAnchors(simplified);
  return { anchors, hasArea: true };
}
