import type { Point, Rect } from '../../types';
import type { TransformHandle } from '../../tools/transform/transform';

/**
 * Where to press and release a Move-tool transform handle so that the drag
 * turns or scales the box by a requested amount. Nothing here produces a
 * transform: it only picks pointer positions, and evaluates what the
 * handlers would read from them, so a candidate can be compared with the
 * request.
 *
 * A pointer reaches the handlers on whole document pixels (the command's
 * gesture environment rounds, as the canvas's screenToCanvas does), so
 * every point chosen here is a whole pixel.
 */

/** The box a handle drag acts on, in its own axes. */
export interface DragFrame {
  /** The untransformed rect the handles are drawn around. */
  readonly box: Rect;
  /** A document point in the box's own axes; null when the map is degenerate. */
  toLocal(p: Point): Point | null;
  /** A point in the box's own axes, in the document. */
  toDoc(p: Point): Point;
  /** The point a rotate handle turns about, computed as the handler computes it. */
  readonly pivot: Point;
}

/** The point a scale drag keeps where it is. */
export type ScaleAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

export const SCALE_ANCHORS: readonly ScaleAnchor[] = [
  'top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left',
];

const OPPOSITE: Readonly<Record<ScaleAnchor, TransformHandle>> = {
  'top-left': 'bottom-right',
  'top': 'bottom',
  'top-right': 'bottom-left',
  'right': 'left',
  'bottom-right': 'top-left',
  'bottom': 'top',
  'bottom-left': 'top-right',
  'left': 'right',
};

/** The handle a scale about `anchor` drags: the one opposite it. */
export function handleForAnchor(anchor: ScaleAnchor): TransformHandle {
  return OPPOSITE[anchor];
}

/** Which axes an anchor's drag scales: a corner both, an edge one. */
export function anchorAxes(anchor: ScaleAnchor): { x: boolean; y: boolean } {
  const handle = handleForAnchor(anchor);
  return {
    x: handle.endsWith('left') || handle.endsWith('right'),
    y: handle.startsWith('top') || handle.startsWith('bottom'),
  };
}

export const ROTATE_HANDLE: TransformHandle = 'rotate-top-right';

/** Farthest a rotation's release goes from the pivot: far enough that a whole pixel resolves the angle finely. */
export const MAX_ROTATE_REACH = 4096;

/** The coordinate range a release point must stay in. */
export interface Limits {
  readonly min: number;
  readonly max: number;
}

function within(p: Point, limits: Limits): boolean {
  return p.x >= limits.min && p.x <= limits.max && p.y >= limits.min && p.y <= limits.max;
}

/** `a` brought into (-π, π]. */
export function wrapAngle(a: number): number {
  const turn = 2 * Math.PI;
  let r = a % turn;
  if (r > Math.PI) r -= turn;
  if (r <= -Math.PI) r += turn;
  return r;
}

export function angleAbout(pivot: Point, p: Point): number {
  return Math.atan2(p.y - pivot.y, p.x - pivot.x);
}

/** The angle a rotate-handle drag from `press` to `release` turns by, as the handlers measure it. */
export function rotationReached(pivot: Point, press: Point, release: Point): number {
  return angleAbout(pivot, release) - angleAbout(pivot, press);
}

/**
 * The whole-pixel point, out from the pivot along the direction `press`
 * turned by `theta`, whose drag from `press` turns nearest to `theta`.
 * Walks the ray one pixel at a time along its steeper axis, up to `reach`
 * pixels out, so every whole pixel next to the ray is tried; null when the
 * ray leaves `limits` at once.
 */
export function rotateRelease(
  pivot: Point,
  press: Point,
  theta: number,
  limits: Limits,
  reach: number = MAX_ROTATE_REACH,
): { point: Point; reached: number } | null {
  const direction = angleAbout(pivot, press) + theta;
  const u = { x: Math.cos(direction), y: Math.sin(direction) };
  const alongX = Math.abs(u.x) >= Math.abs(u.y);
  const main = alongX ? u.x : u.y;
  const other = alongX ? u.y : u.x;
  const pivotMain = alongX ? pivot.x : pivot.y;
  const pivotOther = alongX ? pivot.y : pivot.x;
  const sign = Math.sign(main);
  const steps = Math.floor(reach * Math.abs(main));
  let best: { point: Point; reached: number; error: number } | null = null;
  for (let k = 1; k <= steps; k++) {
    const m = Math.round(pivotMain) + sign * k;
    const t = (m - pivotMain) / main;
    if (t < 1) continue;
    const o = Math.round(pivotOther + t * other);
    const point = alongX ? { x: m, y: o } : { x: o, y: m };
    if (!within(point, limits)) break;
    const reached = rotationReached(pivot, press, point);
    const error = Math.abs(wrapAngle(reached - theta));
    if (!best || error < best.error) best = { point, reached, error };
  }
  return best ? { point: best.point, reached: best.reached } : null;
}

interface HandleAxes {
  readonly movesX: boolean;
  readonly movesY: boolean;
  /** The dragged edge's position and the fixed one's, in the box's own axes. */
  readonly edgeX: number;
  readonly fixedX: number;
  readonly edgeY: number;
  readonly fixedY: number;
}

/** The edges a scale handle moves and the ones it keeps, as the handlers read them. */
export function handleAxes(box: Rect, handle: TransformHandle): HandleAxes {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const movesLeft = handle.endsWith('left');
  const movesRight = handle.endsWith('right');
  const movesTop = handle.startsWith('top');
  const movesBottom = handle.startsWith('bottom');
  return {
    movesX: movesLeft || movesRight,
    movesY: movesTop || movesBottom,
    edgeX: movesRight ? right : left,
    fixedX: movesRight ? left : right,
    edgeY: movesBottom ? bottom : top,
    fixedY: movesBottom ? top : bottom,
  };
}

/** The factors a scale-handle drag from `press` to `release` stretches the box by, along its own axes. */
export function scaleReached(frame: DragFrame, handle: TransformHandle, press: Point, release: Point): Point | null {
  const s = frame.toLocal(press);
  const c = frame.toLocal(release);
  if (!s || !c) return null;
  const axes = handleAxes(frame.box, handle);
  return {
    x: axes.movesX ? 1 + (c.x - s.x) / (axes.edgeX - axes.fixedX) : 1,
    y: axes.movesY ? 1 + (c.y - s.y) / (axes.edgeY - axes.fixedY) : 1,
  };
}

/**
 * The whole-pixel release, of the four around the exact one, whose drag of
 * `handle` from `press` stretches the box nearest to `factor`; null when
 * none is inside `limits`.
 */
export function scaleRelease(
  frame: DragFrame,
  handle: TransformHandle,
  press: Point,
  factor: Point,
  limits: Limits,
): { point: Point; reached: Point } | null {
  const s = frame.toLocal(press);
  if (!s) return null;
  const axes = handleAxes(frame.box, handle);
  const spanX = axes.edgeX - axes.fixedX;
  const spanY = axes.edgeY - axes.fixedY;
  const exact = frame.toDoc({
    x: s.x + (axes.movesX ? (factor.x - 1) * spanX : 0),
    y: s.y + (axes.movesY ? (factor.y - 1) * spanY : 0),
  });
  let best: { point: Point; reached: Point; error: number } | null = null;
  for (const x of new Set([Math.floor(exact.x), Math.ceil(exact.x)])) {
    for (const y of new Set([Math.floor(exact.y), Math.ceil(exact.y)])) {
      const point = { x, y };
      if (!within(point, limits)) continue;
      const reached = scaleReached(frame, handle, press, point);
      if (!reached) continue;
      const error = Math.abs(reached.x - factor.x) * Math.abs(spanX) + Math.abs(reached.y - factor.y) * Math.abs(spanY);
      if (!best || error < best.error) best = { point, reached, error };
    }
  }
  return best ? { point: best.point, reached: best.reached } : null;
}

/**
 * A whole-pixel press point that `hitTest` takes for `handle`: the handle's
 * position rounded, else the nearest of the pixels around it. Null when
 * none of them grabs it.
 */
export function pressPoint(
  at: Point,
  handle: TransformHandle,
  hitTest: (p: Point) => TransformHandle | null,
): Point | null {
  const xs = [Math.round(at.x), Math.floor(at.x), Math.ceil(at.x)];
  const ys = [Math.round(at.y), Math.floor(at.y), Math.ceil(at.y)];
  const candidates: Point[] = [];
  for (const x of xs) for (const y of ys) candidates.push({ x, y });
  candidates.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
  return candidates.find((p) => hitTest(p) === handle) ?? null;
}

/** The edge a skew keeps where it is: the handle of the edge opposite slides along itself. */
export type SkewAnchor = 'top' | 'right' | 'bottom' | 'left';

export const SKEW_ANCHORS: readonly SkewAnchor[] = ['top', 'right', 'bottom', 'left'];

/** Whether a skew anchor's drag shears along x (a top or bottom edge slides sideways) or along y. */
export function skewAxis(anchor: SkewAnchor): 'x' | 'y' {
  return anchor === 'top' || anchor === 'bottom' ? 'x' : 'y';
}

interface SkewEdge {
  /** Whether the dragged edge slides along the box's x axis. */
  readonly slidesX: boolean;
  /** Which side of the box centre the dragged edge is on: bottom and right are positive. */
  readonly side: 1 | -1;
  /** The distance between the dragged edge and the one held, in the box's own axes. */
  readonly span: number;
}

function skewEdge(box: Rect, handle: TransformHandle): SkewEdge {
  const slidesX = handle === 'top' || handle === 'bottom';
  return {
    slidesX,
    side: handle === 'bottom' || handle === 'right' ? 1 : -1,
    span: slidesX ? box.height : box.width,
  };
}

/**
 * The shear, as the tangent of its angle, that an edge-handle drag from
 * `press` to `release` gives in Skew mode: the dragged edge follows the
 * pointer along itself while the opposite edge holds, as the handlers
 * compute it. Positive slides a bottom edge right or a right edge down.
 */
export function skewReached(frame: DragFrame, handle: TransformHandle, press: Point, release: Point): number | null {
  const s = frame.toLocal(press);
  const c = frame.toLocal(release);
  const edge = skewEdge(frame.box, handle);
  if (!s || !c || edge.span === 0) return null;
  return (edge.side * (edge.slidesX ? c.x - s.x : c.y - s.y)) / edge.span;
}

/**
 * The whole-pixel release, of the four around the exact one, whose drag of
 * the edge `handle` from `press` shears nearest to `tan`; null when none is
 * inside `limits`.
 */
export function skewRelease(
  frame: DragFrame,
  handle: TransformHandle,
  press: Point,
  tan: number,
  limits: Limits,
): { point: Point; reached: number } | null {
  const s = frame.toLocal(press);
  if (!s) return null;
  const edge = skewEdge(frame.box, handle);
  const travel = edge.side * edge.span * tan;
  const exact = frame.toDoc({ x: s.x + (edge.slidesX ? travel : 0), y: s.y + (edge.slidesX ? 0 : travel) });
  let best: { point: Point; reached: number; error: number } | null = null;
  for (const x of new Set([Math.floor(exact.x), Math.ceil(exact.x)])) {
    for (const y of new Set([Math.floor(exact.y), Math.ceil(exact.y)])) {
      const point = { x, y };
      if (!within(point, limits)) continue;
      const reached = skewReached(frame, handle, press, point);
      if (reached === null) continue;
      const error = Math.abs(reached - tan);
      if (!best || error < best.error) best = { point, reached, error };
    }
  }
  return best ? { point: best.point, reached: best.reached } : null;
}

/** A corner of the box, in the order the editor keeps corner offsets: clockwise from the top-left. */
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/**
 * Whether four corners, in order round the shape, outline a convex quad with
 * no three in a line: the only quads a corner distortion maps a rectangle
 * onto without folding it. Either winding counts, so a mirrored quad does.
 */
export function isConvexQuad(corners: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const c = corners[(i + 2) % corners.length];
    if (!a || !b || !c) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return corners.length === 4;
}
