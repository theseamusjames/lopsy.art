import type { Point } from '../../../types';
import type { StoredPath } from '../../../types/paths';
import type { Guide } from '../../ui-store';

export type CanvasTurn = 'cw' | 'ccw';

/**
 * CW maps (x, y) → (H − y, x); CCW maps (x, y) → (y, W − x), where W × H is
 * the document size before the turn.
 */
export function rotateDocumentPoint(p: Point, direction: CanvasTurn, docWidth: number, docHeight: number): Point {
  return direction === 'cw'
    ? { x: docHeight - p.y, y: p.x }
    : { x: p.y, y: docWidth - p.x };
}

/**
 * Paths and guides live in document coordinates, so Image → Rotate 90° turns
 * them with the pixels — otherwise they stay at the old coordinates, off the
 * rotated artwork (#1401).
 */
export function rotatePathsForCanvas(
  paths: readonly StoredPath[],
  direction: CanvasTurn,
  docWidth: number,
  docHeight: number,
): StoredPath[] {
  const turn = (p: Point): Point => rotateDocumentPoint(p, direction, docWidth, docHeight);
  return paths.map((path) => ({
    ...path,
    anchors: path.anchors.map((a) => ({
      point: turn(a.point),
      handleIn: a.handleIn ? turn(a.handleIn) : null,
      handleOut: a.handleOut ? turn(a.handleOut) : null,
    })),
  }));
}

export function rotateGuidesForCanvas(
  guides: readonly Guide[],
  direction: CanvasTurn,
  docWidth: number,
  docHeight: number,
): Guide[] {
  return guides.map((g) => {
    if (g.orientation === 'vertical') {
      return { ...g, orientation: 'horizontal', position: direction === 'cw' ? g.position : docWidth - g.position };
    }
    return { ...g, orientation: 'vertical', position: direction === 'cw' ? docHeight - g.position : g.position };
  });
}
