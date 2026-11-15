import type { Point, Rect } from '../../types';

export type MarqueeShape = 'rect' | 'ellipse';

export interface MarqueeCorners {
  from: Point;
  to: Point;
}

/** Side length the Marquee Region modal pre-fills when the user just clicks. */
export const DEFAULT_REGION_SIZE = 100;

/**
 * Normalize two typed corners into a selection rect. `to` is exclusive, the
 * same as a drag: From (10, 10) To (110, 60) selects a 100×50 region. Corners
 * may be given in either order. Returns null for a zero-area region.
 */
export function regionFromCorners(from: Point, to: Point): Rect | null {
  const x0 = Math.round(Math.min(from.x, to.x));
  const y0 = Math.round(Math.min(from.y, to.y));
  const x1 = Math.round(Math.max(from.x, to.x));
  const y1 = Math.round(Math.max(from.y, to.y));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) return null;
  return { x: x0, y: y0, width, height };
}

function defaultSpan(clicked: number, docSize: number): [number, number] {
  const start = Math.max(0, Math.min(docSize, Math.round(clicked)));
  const end = Math.min(docSize, start + DEFAULT_REGION_SIZE);
  if (end - start >= 1) return [start, end];
  return [Math.max(0, end - DEFAULT_REGION_SIZE), end];
}

/**
 * Corners the modal opens with: anchored at the clicked point and extending
 * down-right by DEFAULT_REGION_SIZE, pulled back inside the document when the
 * click lands on its right or bottom edge.
 */
export function defaultMarqueeCorners(click: Point, docW: number, docH: number): MarqueeCorners {
  const [fromX, toX] = defaultSpan(click.x, docW);
  const [fromY, toY] = defaultSpan(click.y, docH);
  return { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
}
