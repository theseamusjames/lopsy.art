import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getCornerPositions } from './transform';

/**
 * Applies the same transform chain used by the pixel renderer:
 * translate(-origCenter) → skew → scale → rotate → translate(origCenter + offset)
 */
export function transformPoint(px: number, py: number, state: TransformState): Point {
  const origCx = state.originalBounds.x + state.originalBounds.width / 2;
  const origCy = state.originalBounds.y + state.originalBounds.height / 2;

  // 1. Translate to origin
  let x = px - origCx;
  let y = py - origCy;

  // 2. Skew
  const tanSkewX = Math.tan(state.skewX);
  const tanSkewY = Math.tan(state.skewY);
  const sx = x + y * tanSkewX;
  const sy = x * tanSkewY + y;
  x = sx;
  y = sy;

  // 3. Scale
  x *= state.scaleX;
  y *= state.scaleY;

  // 4. Rotate
  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  // 5. Translate to final position
  return {
    x: rx + origCx + state.translateX,
    y: ry + origCy + state.translateY,
  };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Distance (doc px, per axis) a rotate handle sits outside its corner. */
export const ROTATE_HANDLE_OFFSET = 20;

function isCornerMode(state: TransformState): boolean {
  return state.mode === 'distort' || state.mode === 'perspective';
}

export function getHandlePositions(
  state: TransformState,
): Record<TransformHandle, Point> {
  if (isCornerMode(state)) {
    // In distort/perspective modes, corners are positioned directly
    const [tl, tr, br, bl] = getCornerPositions(state);
    const rotOff = ROTATE_HANDLE_OFFSET;

    // Direction vectors for rotation handle offsets
    function cornerOffset(corner: Point, adj1: Point, adj2: Point): Point {
      const dx1 = corner.x - adj1.x;
      const dy1 = corner.y - adj1.y;
      const dx2 = corner.x - adj2.x;
      const dy2 = corner.y - adj2.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const len2 = Math.hypot(dx2, dy2) || 1;
      return {
        x: corner.x + (dx1 / len1 + dx2 / len2) * rotOff,
        y: corner.y + (dy1 / len1 + dy2 / len2) * rotOff,
      };
    }

    return {
      'top-left': tl,
      'top': mid(tl, tr),
      'top-right': tr,
      'right': mid(tr, br),
      'bottom-right': br,
      'bottom': mid(bl, br),
      'bottom-left': bl,
      'left': mid(tl, bl),
      'rotate-top-left': cornerOffset(tl, tr, bl),
      'rotate-top-right': cornerOffset(tr, tl, br),
      'rotate-bottom-right': cornerOffset(br, tr, bl),
      'rotate-bottom-left': cornerOffset(bl, tl, br),
    };
  }

  const ob = state.originalBounds;
  const left = ob.x;
  const right = ob.x + ob.width;
  const top = ob.y;
  const bottom = ob.y + ob.height;
  const midX = ob.x + ob.width / 2;
  const midY = ob.y + ob.height / 2;

  const tl = transformPoint(left, top, state);
  const tr = transformPoint(right, top, state);
  const bl = transformPoint(left, bottom, state);
  const br = transformPoint(right, bottom, state);

  // Edge midpoints
  const topMid = transformPoint(midX, top, state);
  const bottomMid = transformPoint(midX, bottom, state);
  const leftMid = transformPoint(left, midY, state);
  const rightMid = transformPoint(right, midY, state);

  // Rotation handles offset outside corners
  const rotOff = ROTATE_HANDLE_OFFSET;

  return {
    'top-left': tl,
    'top': topMid,
    'top-right': tr,
    'right': rightMid,
    'bottom-right': br,
    'bottom': bottomMid,
    'bottom-left': bl,
    'left': leftMid,
    'rotate-top-left': transformPoint(left - rotOff, top - rotOff, state),
    'rotate-top-right': transformPoint(right + rotOff, top - rotOff, state),
    'rotate-bottom-right': transformPoint(right + rotOff, bottom + rotOff, state),
    'rotate-bottom-left': transformPoint(left - rotOff, bottom + rotOff, state),
  };
}

const ROTATE_HANDLES: readonly TransformHandle[] = [
  'rotate-top-left',
  'rotate-top-right',
  'rotate-bottom-right',
  'rotate-bottom-left',
];

const SCALE_HANDLES: readonly TransformHandle[] = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
];

function nearestWithin(
  point: Point,
  positions: Record<TransformHandle, Point>,
  handles: readonly TransformHandle[],
  radius: number,
): TransformHandle | null {
  let best: TransformHandle | null = null;
  let bestDistSq = radius * radius;
  for (const handle of handles) {
    const pos = positions[handle];
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > bestDistSq) continue;
    best = handle;
    bestDistSq = distSq;
  }
  return best;
}

/**
 * Rotation handles are checked first (they sit further out and take
 * priority where the two overlap). Where scale-handle circles overlap
 * each other — only on a box under two radii across — the nearest wins.
 */
export function hitTestHandle(
  point: Point,
  state: TransformState,
  handleRadius: number,
  rotateHandleRadius: number = handleRadius,
): TransformHandle | null {
  const positions = getHandlePositions(state);
  return nearestWithin(point, positions, ROTATE_HANDLES, rotateHandleRadius)
    ?? nearestWithin(point, positions, SCALE_HANDLES, handleRadius);
}

/** Screen px radius of a handle's hit circle. */
export const HANDLE_HIT_RADIUS_PX = 8;

/**
 * Deepest a scale-handle grab reaches into a box, as a fraction of the
 * box's smaller half-extent. The rest of the box is a move zone.
 */
export const HANDLE_INSIDE_BAND_FRACTION = 0.25;

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

type Edge = readonly [Point, Point];

function isInsideEdges(point: Point, edges: readonly Edge[]): boolean {
  let isInside = false;
  for (const [a, b] of edges) {
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      isInside = !isInside;
    }
  }
  return isInside;
}

/**
 * How far `point` lies inside the box outlined by the corner handles
 * (distance to the nearest edge), or 0 when it is on or outside it.
 */
export function depthInsideBox(point: Point, positions: Record<TransformHandle, Point>): number {
  const tl = positions['top-left'];
  const tr = positions['top-right'];
  const br = positions['bottom-right'];
  const bl = positions['bottom-left'];
  const edges: Edge[] = [[tl, tr], [tr, br], [br, bl], [bl, tl]];
  if (!isInsideEdges(point, edges)) return 0;
  return Math.min(...edges.map(([a, b]) => distanceToSegment(point, a, b)));
}

function halfMinExtent(positions: Record<TransformHandle, Point>): number {
  const tl = positions['top-left'];
  const tr = positions['top-right'];
  const br = positions['bottom-right'];
  const bl = positions['bottom-left'];
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return Math.min(width, height) / 2;
}

/**
 * Hit-test the Move tool's box handles at `zoom`. A scale handle's circle
 * is `HANDLE_HIT_RADIUS_PX` screen px around its drawn position, but inside
 * the box it reaches at most `HANDLE_INSIDE_BAND_FRACTION` of the box's
 * smaller half-extent: on a small box (a 13px text label at fit zoom) most
 * of the interior stays a move zone and the handles are grabbed from just
 * outside the outline (#1200). On a box wider than four handle radii the
 * band covers the whole circle, so nothing changes there.
 */
export function hitTestBoxHandle(point: Point, state: TransformState, zoom: number): TransformHandle | null {
  const positions = getHandlePositions(state);
  const radius = HANDLE_HIT_RADIUS_PX / zoom;
  const halfMin = halfMinExtent(positions);
  // Rotation handles keep their #1000 radius: at least what the scale
  // handles had, and short of the corner at low zoom.
  const clampedRadius = Math.max(1, Math.min(radius, halfMin * 0.8));
  const rotateCornerClearance = ROTATE_HANDLE_OFFSET * Math.SQRT2 * 0.8;
  const rotateRadius = Math.max(clampedRadius, Math.min(radius, rotateCornerClearance));
  const rotateHit = nearestWithin(point, positions, ROTATE_HANDLES, rotateRadius);
  if (rotateHit) return rotateHit;

  const insideBand = Math.min(radius, halfMin * HANDLE_INSIDE_BAND_FRACTION);
  if (depthInsideBox(point, positions) > insideBand) return null;
  return nearestWithin(point, positions, SCALE_HANDLES, radius);
}

export function isScaleHandle(handle: TransformHandle): boolean {
  return !handle.startsWith('rotate-');
}

export function isRotateHandle(handle: TransformHandle): boolean {
  return handle.startsWith('rotate-');
}

export function getCursorForHandle(handle: TransformHandle): string {
  if (isRotateHandle(handle)) return 'crosshair';

  const cursorMap: Record<string, string> = {
    'top-left': 'nwse-resize',
    'top': 'ns-resize',
    'top-right': 'nesw-resize',
    'right': 'ew-resize',
    'bottom-right': 'nwse-resize',
    'bottom': 'ns-resize',
    'bottom-left': 'nesw-resize',
    'left': 'ew-resize',
  };

  return cursorMap[handle] ?? 'default';
}
