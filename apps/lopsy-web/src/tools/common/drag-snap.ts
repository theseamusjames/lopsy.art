import type { Point } from '../../types';
import { snapPositionToGrid, snapToGuide } from '../move/move';

/**
 * How close, in screen pixels, a dragged edge must come to a guide to land
 * on it. Measured on screen so the pull feels the same at every zoom — the
 * same 8 px reach as a transform handle's hit area.
 */
export const GUIDE_SNAP_SCREEN_PX = 8;

export interface DragSnapOptions {
  /** Grid lattice to quantize to, or null when grid snapping is off. */
  readonly grid: { readonly size: number; readonly docWidth: number; readonly docHeight: number } | null;
  /** X positions of vertical guides. */
  readonly verticalGuides: readonly number[];
  /** Y positions of horizontal guides. */
  readonly horizontalGuides: readonly number[];
  /** Guide reach in document pixels. */
  readonly guideThreshold: number;
}

/**
 * Snap one point of a drag-out box (a marquee corner, a shape's centre or
 * corner). Each axis lands on a guide within reach first — a guide is a line
 * the user placed on purpose — and otherwise on the grid when grid snapping
 * is on.
 */
export function snapDragPoint(p: Point, options: DragSnapOptions): Point {
  const onGrid = options.grid
    ? snapPositionToGrid(p.x, p.y, options.grid.size, options.grid.docWidth, options.grid.docHeight)
    : p;
  const gx = snapToGuide(p.x, options.verticalGuides, options.guideThreshold);
  const gy = snapToGuide(p.y, options.horizontalGuides, options.guideThreshold);
  return {
    x: gx.snapped ? gx.value : onGrid.x,
    y: gy.snapped ? gy.value : onGrid.y,
  };
}

export interface SnappedDragBox {
  readonly start: Point;
  readonly end: Point;
}

/**
 * Snap both corners of a drag-out box. On an axis where both corners would
 * land on the same guide or grid line although the drag spans it, that axis
 * keeps the drawn coordinates: a thin box dragged across a guide would
 * otherwise collapse to zero size and select nothing (#1499).
 */
export function snapDragBox(start: Point, end: Point, options: DragSnapOptions): SnappedDragBox {
  const s = snapDragPoint(start, options);
  const e = snapDragPoint(end, options);
  const isXCollapsed = s.x === e.x && start.x !== end.x;
  const isYCollapsed = s.y === e.y && start.y !== end.y;
  return {
    start: { x: isXCollapsed ? start.x : s.x, y: isYCollapsed ? start.y : s.y },
    end: { x: isXCollapsed ? end.x : e.x, y: isYCollapsed ? end.y : e.y },
  };
}
