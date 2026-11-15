import type { PathAnchor } from '../tools/path/path';
import type { Point } from '../types';

const THRESHOLD = 128;

/**
 * Convert a selection mask to an array of PathAnchors by:
 * 1. Running marching squares to extract contour edge segments
 * 2. Chaining segments into ordered polylines
 * 3. Simplifying each closed contour with Douglas-Peucker
 * 4. Fitting Bezier anchors: corners keep straight handles along their
 *    edges, curve points get tangent-continuous handles
 */
export function selectionToPath(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 2,
): PathAnchor[] {
  const polylines = traceContourPolylines(mask, width, height);
  if (polylines.length === 0) return [];

  // Use the longest polyline as the primary contour
  const primary = polylines.reduce(
    (best, cur) => (cur.length > best.length ? cur : best),
    polylines[0]!,
  );

  return contourToAnchors(primary, tolerance);
}

/**
 * Convert every contour of a selection mask to its own closed anchor list,
 * so a selection made of several separate regions (or one with holes)
 * keeps all of them (#1133). Ordered top-to-bottom, then left-to-right.
 */
export function selectionToPaths(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 2,
): PathAnchor[][] {
  const polylines = traceContourPolylines(mask, width, height);
  const withOrigin = polylines.map((pts) => ({ pts, origin: topLeftPoint(pts) }));
  withOrigin.sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x);
  const result: PathAnchor[][] = [];
  for (const { pts } of withOrigin) {
    const anchors = contourToAnchors(pts, tolerance);
    if (anchors.length >= 3) result.push(anchors);
  }
  return result;
}

function topLeftPoint(pts: Point[]): Point {
  let best = pts[0]!;
  for (const p of pts) {
    if (p.y < best.y || (p.y === best.y && p.x < best.x)) best = p;
  }
  return best;
}

function contourToAnchors(contour: Point[], tolerance: number): PathAnchor[] {
  const vertexIndices = simplifyClosedContour(contour, tolerance);
  if (vertexIndices.length < 2) return [];
  return fitAnchors(contour, vertexIndices);
}

// ---------------------------------------------------------------------------
// Marching squares: extract contour polylines
// ---------------------------------------------------------------------------

/** Returns all contour polylines as arrays of {x, y} points. */
function traceContourPolylines(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Point[][] {
  // Use pixel-boundary approach: for each pixel edge where selection transitions,
  // build a set of unit segments, then chain them into polylines.
  // Edge coordinates are in pixel-corner space (0..width, 0..height).

  // Collect directed edge segments. Each segment is [x1,y1,x2,y2] on the boundary.
  // We store them as strings for fast lookup.
  const segSet = new Set<string>();
  const segList: [number, number, number, number][] = [];

  const isSelected = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return (mask[y * width + x] ?? 0) >= THRESHOLD;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isSelected(x, y)) continue;

      // Top edge: y → y, x → x+1 (if top neighbor is unselected)
      if (!isSelected(x, y - 1)) {
        addSeg(segSet, segList, x, y, x + 1, y);
      }
      // Bottom edge
      if (!isSelected(x, y + 1)) {
        addSeg(segSet, segList, x + 1, y + 1, x, y + 1);
      }
      // Left edge
      if (!isSelected(x - 1, y)) {
        addSeg(segSet, segList, x, y + 1, x, y);
      }
      // Right edge
      if (!isSelected(x + 1, y)) {
        addSeg(segSet, segList, x + 1, y, x + 1, y + 1);
      }
    }
  }

  if (segList.length === 0) return [];

  return chainSegments(segList);
}

function addSeg(
  segSet: Set<string>,
  segList: [number, number, number, number][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const key = `${x1},${y1},${x2},${y2}`;
  if (!segSet.has(key)) {
    segSet.add(key);
    segList.push([x1, y1, x2, y2]);
  }
}

/** Chain edge segments into closed polylines. */
function chainSegments(segs: [number, number, number, number][]): Point[][] {
  // Build adjacency: tail → segment index
  const tailMap = new Map<string, number[]>();
  const ptKey = (x: number, y: number) => `${x},${y}`;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    // Directed: head is (s[0],s[1]), tail is (s[2],s[3])
    const tailK = ptKey(s[0], s[1]); // segment starts at s[0],s[1]
    const list = tailMap.get(tailK);
    if (list) list.push(i);
    else tailMap.set(tailK, [i]);
  }

  const used = new Uint8Array(segs.length);
  const polylines: Point[][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i]!;
    const pts: Point[] = [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }];

    let tailK = ptKey(s[2], s[3]);

    for (;;) {
      const neighbors = tailMap.get(tailK);
      if (!neighbors) break;
      let found = false;
      for (const ni of neighbors) {
        if (used[ni]) continue;
        used[ni] = 1;
        const ns = segs[ni]!;
        pts.push({ x: ns[2], y: ns[3] });
        tailK = ptKey(ns[2], ns[3]);
        found = true;
        break;
      }
      if (!found) break;
    }

    // Remove duplicate close point if polyline closed on itself
    if (pts.length > 2) {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (first.x === last.x && first.y === last.y) {
        pts.pop();
      }
    }

    if (pts.length >= 3) polylines.push(pts);
  }

  return polylines;
}

// ---------------------------------------------------------------------------
// Closed-contour Douglas-Peucker simplification
// ---------------------------------------------------------------------------

/**
 * Simplify a closed contour and return the indices of the kept vertices in
 * contour order. The contour is split at two mutually distant points rather
 * than at its arbitrary trace start: those are extreme points of the shape
 * (corners on a rectangle), so no forced anchor lands mid-edge or right
 * next to another one (#1276).
 */
function simplifyClosedContour(contour: Point[], tolerance: number): number[] {
  const n = contour.length;
  if (n < 3) return contour.map((_, i) => i);

  const a = farthestIndex(contour, contour[0]!);
  const b = farthestIndex(contour, contour[a]!);
  if (a === b) return [a];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const keep = new Uint8Array(n);
  keep[lo] = 1;
  keep[hi] = 1;
  douglasPeuckerRange(contour, lo, hi - lo, tolerance, keep);
  douglasPeuckerRange(contour, hi, n - hi + lo, tolerance, keep);

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(i);
  }
  return result;
}

function farthestIndex(points: Point[], from: Point): number {
  let best = 0;
  let bestDist = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Douglas-Peucker over the cyclic index range [start, start + span]. */
function douglasPeuckerRange(
  contour: Point[],
  start: number,
  span: number,
  tolerance: number,
  keep: Uint8Array,
): void {
  const n = contour.length;
  const stack: [number, number][] = [[start, span]];
  while (stack.length > 0) {
    const [s, len] = stack.pop()!;
    if (len < 2) continue;
    const first = contour[s % n]!;
    const last = contour[(s + len) % n]!;
    let maxDist = 0;
    let maxOff = 0;
    for (let k = 1; k < len; k++) {
      const d = perpendicularDistance(contour[(s + k) % n]!, first, last);
      if (d > maxDist) {
        maxDist = d;
        maxOff = k;
      }
    }
    if (maxDist <= tolerance) continue;
    keep[(s + maxOff) % n] = 1;
    stack.push([s, maxOff], [s + maxOff, len - maxOff]);
  }
}

function perpendicularDistance(pt: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return Math.sqrt((pt.x - lineStart.x) ** 2 + (pt.y - lineStart.y) ** 2);
  }
  return Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

// ---------------------------------------------------------------------------
// Anchor fitting
// ---------------------------------------------------------------------------

/** Turning angle (radians) above which a vertex is treated as a corner. */
const CORNER_ANGLE = (55 * Math.PI) / 180;

/**
 * How far along the traced contour (in unit boundary steps) to look on each
 * side of a vertex when measuring its turning angle. Long enough to see past
 * pixel stair-steps, short enough that a gentle curve doesn't read as a
 * corner just because the simplifier spaced its anchors far apart.
 */
const CORNER_PROBE = 8;

const HANDLE_FRACTION = 1 / 3;

/**
 * Build closed-path anchors from the simplified vertices. Corners get
 * handles lying on their adjacent edges (so straight runs stay straight);
 * smooth vertices get collinear handles along the bisected tangent. Every
 * handle is a third of the segment it belongs to, so it cannot reach past
 * the neighbouring anchor the way chord-length Catmull-Rom handles do.
 */
function fitAnchors(contour: Point[], vertexIndices: number[]): PathAnchor[] {
  const n = contour.length;
  const m = vertexIndices.length;
  const anchors: PathAnchor[] = [];

  for (let i = 0; i < m; i++) {
    const prevIdx = vertexIndices[(i - 1 + m) % m]!;
    const currIdx = vertexIndices[i]!;
    const nextIdx = vertexIndices[(i + 1) % m]!;
    const prev = contour[prevIdx]!;
    const curr = contour[currIdx]!;
    const next = contour[nextIdx]!;

    const inX = curr.x - prev.x;
    const inY = curr.y - prev.y;
    const outX = next.x - curr.x;
    const outY = next.y - curr.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);

    const point = { x: curr.x, y: curr.y };
    if (inLen === 0 || outLen === 0) {
      anchors.push({ point, handleIn: null, handleOut: null });
      continue;
    }

    const stepsBack = (currIdx - prevIdx + n) % n || n;
    const stepsFwd = (nextIdx - currIdx + n) % n || n;
    if (isCorner(contour, currIdx, stepsBack, stepsFwd)) {
      anchors.push({
        point,
        handleIn: { x: curr.x - inX * HANDLE_FRACTION, y: curr.y - inY * HANDLE_FRACTION },
        handleOut: { x: curr.x + outX * HANDLE_FRACTION, y: curr.y + outY * HANDLE_FRACTION },
      });
      continue;
    }

    let tx = inX / inLen + outX / outLen;
    let ty = inY / inLen + outY / outLen;
    const tLen = Math.hypot(tx, ty);
    if (tLen === 0) {
      anchors.push({ point, handleIn: null, handleOut: null });
      continue;
    }
    tx /= tLen;
    ty /= tLen;
    const hIn = inLen * HANDLE_FRACTION;
    const hOut = outLen * HANDLE_FRACTION;
    anchors.push({
      point,
      handleIn: { x: curr.x - tx * hIn, y: curr.y - ty * hIn },
      handleOut: { x: curr.x + tx * hOut, y: curr.y + ty * hOut },
    });
  }

  return anchors;
}

/**
 * Measure the turn at a vertex from the traced contour itself rather than
 * from the simplified neighbours: a tight curve simplified to few anchors
 * turns sharply between them, but its contour bends gradually.
 */
function isCorner(contour: Point[], idx: number, stepsBack: number, stepsFwd: number): boolean {
  const n = contour.length;
  const back = Math.max(1, Math.min(CORNER_PROBE, stepsBack));
  const fwd = Math.max(1, Math.min(CORNER_PROBE, stepsFwd));
  const curr = contour[idx]!;
  const before = contour[(idx - back + n) % n]!;
  const after = contour[(idx + fwd) % n]!;
  const ax = curr.x - before.x;
  const ay = curr.y - before.y;
  const bx = after.x - curr.x;
  const by = after.y - curr.y;
  const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  return turn > CORNER_ANGLE;
}
