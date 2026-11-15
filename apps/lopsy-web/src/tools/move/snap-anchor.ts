import type { Point, Rect } from '../../types';
import { snapPositionToGrid } from './move';

export type HorizontalSnapAnchor = 'left' | 'center' | 'right';
export type VerticalSnapAnchor = 'top' | 'middle' | 'bottom';

/** Which point of the moving content's bounding box lands on the grid. */
export interface SnapAnchor {
  readonly horizontal: HorizontalSnapAnchor;
  readonly vertical: VerticalSnapAnchor;
}

/** The top-left corner: what a Move drag snapped before anchors existed. */
export const DEFAULT_SNAP_ANCHOR: SnapAnchor = { horizontal: 'left', vertical: 'top' };

const FRACTION_X: Record<HorizontalSnapAnchor, number> = { left: 0, center: 0.5, right: 1 };
const FRACTION_Y: Record<VerticalSnapAnchor, number> = { top: 0, middle: 0.5, bottom: 1 };

/** The anchor point of `box` in document space. */
export function anchorPoint(box: Rect, anchor: SnapAnchor): Point {
  return {
    x: box.x + box.width * FRACTION_X[anchor.horizontal],
    y: box.y + box.height * FRACTION_Y[anchor.vertical],
  };
}

/**
 * Whole-pixel shift that puts `box`'s anchor on the document-centred grid
 * (or on a canvas edge within half a cell), as `snapPositionToGrid` does.
 */
export function snapBoxToGrid(
  box: Rect,
  anchor: SnapAnchor,
  gridSize: number,
  docWidth: number,
  docHeight: number,
): Point {
  const p = anchorPoint(box, anchor);
  const snapped = snapPositionToGrid(p.x, p.y, gridSize, docWidth, docHeight);
  return { x: Math.round(snapped.x - p.x), y: Math.round(snapped.y - p.y) };
}
