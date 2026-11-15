import type { Point } from '../../types';
import type { TransformHandle, TransformState, CornerOffsets } from './transform';

function cloneCorners(c: CornerOffsets): CornerOffsets {
  return [{ ...c[0] }, { ...c[1] }, { ...c[2] }, { ...c[3] }];
}

function offsetCorner(c: Point, dx: number, dy: number): Point {
  return { x: c.x + dx, y: c.y + dy };
}

/**
 * Distort: each corner moves independently to wherever the user drags it.
 * Edge handles move both corners of that edge.
 */
export function computeDistort(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
): { corners: CornerOffsets } {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const corners = cloneCorners(state.corners);

  switch (handle) {
    case 'top-left':
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      break;
    case 'top-right':
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      break;
    case 'bottom-right':
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      break;
    case 'bottom-left':
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      break;
    case 'top':
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      break;
    case 'bottom':
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      break;
    case 'left':
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      break;
    case 'right':
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      break;
  }

  return { corners };
}

/**
 * Perspective: moving a corner causes all 4 corners to adjust symmetrically,
 * creating a vanishing-point effect.
 * Edge handles move both corners of that edge uniformly.
 */
export function computePerspective(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
): { corners: CornerOffsets } {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const corners = cloneCorners(state.corners);

  // Perspective: dragging a corner moves both corners on that horizontal
  // edge symmetrically (one moves +dx, the other -dx), while the opposite
  // edge stays fixed. This creates a vanishing-point / trapezoid effect.
  switch (handle) {
    case 'top-left':
      // Top edge: TL moves by (dx, dy), TR mirrors horizontally (-dx, dy)
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      corners[1] = offsetCorner(state.corners[1], -dx, dy);
      // Bottom stays fixed
      break;
    case 'top-right':
      // Top edge: TR moves by (dx, dy), TL mirrors (-dx, dy)
      corners[0] = offsetCorner(state.corners[0], -dx, dy);
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      // Bottom stays fixed
      break;
    case 'bottom-right':
      // Bottom edge: BR moves by (dx, dy), BL mirrors (-dx, dy)
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      corners[3] = offsetCorner(state.corners[3], -dx, dy);
      // Top stays fixed
      break;
    case 'bottom-left':
      // Bottom edge: BL moves by (dx, dy), BR mirrors (-dx, dy)
      corners[2] = offsetCorner(state.corners[2], -dx, dy);
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      // Top stays fixed
      break;
    case 'top':
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      break;
    case 'bottom':
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      break;
    case 'left':
      corners[0] = offsetCorner(state.corners[0], dx, dy);
      corners[3] = offsetCorner(state.corners[3], dx, dy);
      break;
    case 'right':
      corners[1] = offsetCorner(state.corners[1], dx, dy);
      corners[2] = offsetCorner(state.corners[2], dx, dy);
      break;
  }

  return { corners };
}
