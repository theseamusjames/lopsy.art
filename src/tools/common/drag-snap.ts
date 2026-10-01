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
