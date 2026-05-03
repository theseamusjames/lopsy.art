import type { PathAnchor } from '../tools/path/path';
import type { Point } from '../types';

const THRESHOLD = 128;

/**
 * Convert a selection mask to an array of PathAnchors by:
 * 1. Running marching squares to extract contour edge segments
 * 2. Chaining segments into ordered polylines
 * 3. Applying Douglas-Peucker simplification
 * 4. Converting polyline points to Bezier anchors via Catmull-Rom → Bezier
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

  const simplified = douglasPeucker(primary, tolerance);
  if (simplified.length < 2) return [];

  return catmullRomToAnchors(simplified, true);
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
// Douglas-Peucker polyline simplification
// ---------------------------------------------------------------------------

function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line segment endpoints
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    // Merge (left includes the split point, right starts with it — dedupe)
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
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
// Catmull-Rom → Bezier conversion to build smooth PathAnchors
// ---------------------------------------------------------------------------

/**
 * Convert a polyline to PathAnchors with smooth Bezier handles derived
 * from the Catmull-Rom spline tangents.
 */
function catmullRomToAnchors(pts: Point[], closed: boolean): PathAnchor[] {
  const n = pts.length;
  const anchors: PathAnchor[] = [];
  const alpha = 1 / 3; // control point distance factor

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const next2 = pts[(i + 2) % n]!;

    // Catmull-Rom tangent at curr (for handleOut)
    // and tangent at next (for handleIn of next anchor)
    const tangentOut: Point = {
      x: (next.x - prev.x) * alpha,
      y: (next.y - prev.y) * alpha,
    };
    const tangentIn: Point = {
      x: (curr.x - next2.x) * alpha,
      y: (curr.y - next2.y) * alpha,
    };

    // For an open path, clamp first/last anchors to have null handles
    const isFirst = !closed && i === 0;
    const isLast = !closed && i === n - 1;

    anchors.push({
      point: { x: curr.x, y: curr.y },
      handleOut: isFirst || isLast ? null : { x: curr.x + tangentOut.x, y: curr.y + tangentOut.y },
      handleIn: isFirst || isLast ? null : { x: next.x + tangentIn.x, y: next.y + tangentIn.y },
    });
  }

  return anchors;
}
