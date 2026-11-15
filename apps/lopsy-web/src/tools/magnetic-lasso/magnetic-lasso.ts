import type { Point } from '../../types';

/**
 * Snaps a straight segment from `from` to `to` onto the strongest nearby
 * edges, returning the snapped polyline (endpoints included).
 *
 * The engine-backed implementation lives in WASM; tests inject a fake.
 */
export type SnapFn = (from: Point, to: Point) => Point[];

export interface MagneticLassoState {
  /** Committed anchors placed along the path. Always has at least one point. */
  readonly anchors: readonly Point[];
  /**
   * Committed segments between consecutive anchors (one entry per anchor
   * after the first). Each segment starts with its source anchor and ends
   * with the next anchor.
   */
  readonly committedSegments: readonly (readonly Point[])[];
  /**
   * Snapped segment from the last anchor to the current cursor. Includes the
   * last anchor as its first point and the cursor as its last point.
   */
  readonly liveSegment: readonly Point[];
}

/** Start a new magnetic lasso trace at `start`. */
export function beginLasso(start: Point): MagneticLassoState {
  return {
    anchors: [start],
    committedSegments: [],
    liveSegment: [start],
  };
}

/** Recompute the live segment as the cursor moves. */
export function updateCursor(
  state: MagneticLassoState,
  cursor: Point,
  snap: SnapFn,
): MagneticLassoState {
  const last = state.anchors[state.anchors.length - 1];
  if (!last) return state;
  const liveSegment = snap(last, cursor);
  return { ...state, liveSegment };
}

/** Commit the live segment and place a new anchor at `cursor`. */
export function addAnchor(
  state: MagneticLassoState,
  cursor: Point,
  snap: SnapFn,
): MagneticLassoState {
  const last = state.anchors[state.anchors.length - 1];
  if (!last) return state;
  const segment = snap(last, cursor);
  return {
    anchors: [...state.anchors, cursor],
    committedSegments: [...state.committedSegments, segment],
    liveSegment: [cursor],
  };
}

/**
 * Close the path and return the final polyline. If the cursor is supplied,
 * a closing segment is snapped from the last anchor to the first anchor
 * (with the cursor ignored — closing always returns to the origin).
 */
export function closeLasso(
  state: MagneticLassoState,
  snap: SnapFn,
): Point[] {
  const first = state.anchors[0];
  const last = state.anchors[state.anchors.length - 1];
  if (!first || !last) return [];

  const closing = snap(last, first);
  return flattenPolyline({
    anchors: state.anchors,
    committedSegments: [...state.committedSegments, closing],
    liveSegment: [],
  });
}

/**
 * Flatten committed segments + live segment into a single polyline, deduping
 * repeated anchor points at segment boundaries.
 */
export function flattenPolyline(state: MagneticLassoState): Point[] {
  const out: Point[] = [];
  const push = (p: Point) => {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push(p);
  };
  for (const segment of state.committedSegments) {
    for (const p of segment) push(p);
  }
  for (const p of state.liveSegment) push(p);
  return out;
}

/** Convert a WASM `Float32Array` of `[x,y,x,y,...]` into a Point[]. */
export function pointsFromFloat32(flat: Float32Array): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    pts.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return pts;
}

/**
 * Should the cursor auto-place an anchor? True when the cursor has moved
 * more than `frequency` pixels from the most recent anchor along the
 * estimated path length.
 */
export function shouldAutoAnchor(
  state: MagneticLassoState,
  frequency: number,
): boolean {
  if (frequency <= 0) return false;
  const segment = state.liveSegment;
  if (segment.length < 2) return false;
  let len = 0;
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1]!;
    const b = segment[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    len += Math.sqrt(dx * dx + dy * dy);
    if (len >= frequency) return true;
  }
  return false;
}
