import type { Point, TextLayer } from '../../../types';
import type { StoredPath } from '../../../types/paths';
import type { Guide } from '../../ui-store';

/**
 * Paths and guides live in document coordinates, so Canvas Size, Border
 * (expand) and Crop shift them by the same offset as the pixels. Without
 * this they stay at the old coordinates, off the moved artwork.
 */
export function translatePathsForCanvas(
  paths: readonly StoredPath[],
  dx: number,
  dy: number,
): StoredPath[] {
  if (dx === 0 && dy === 0) return [...paths];
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return paths.map((path) => ({
    ...path,
    anchors: path.anchors.map((a) => ({
      point: shift(a.point),
      handleIn: a.handleIn ? shift(a.handleIn) : null,
      handleOut: a.handleOut ? shift(a.handleOut) : null,
    })),
  }));
}

/** Guides outside the new canvas are kept, as Image Size and Rotate keep theirs. */
export function translateGuidesForCanvas(guides: readonly Guide[], dx: number, dy: number): Guide[] {
  return guides.map((g) => ({
    ...g,
    position: g.position + (g.orientation === 'vertical' ? dx : dy),
  }));
}

/**
 * Text moves with the canvas. A path-bound layer's path anchor moves too:
 * `x - pathAnchorX` is the user's offset from the path, and the path itself
 * has shifted by the same amount.
 */
export function translateTextLayerForCanvas<T extends TextLayer>(layer: T, dx: number, dy: number): T {
  return {
    ...layer,
    x: Math.round(layer.x + dx),
    y: Math.round(layer.y + dy),
    ...(layer.pathAnchorX !== undefined ? { pathAnchorX: layer.pathAnchorX + dx } : {}),
    ...(layer.pathAnchorY !== undefined ? { pathAnchorY: layer.pathAnchorY + dy } : {}),
  };
}
