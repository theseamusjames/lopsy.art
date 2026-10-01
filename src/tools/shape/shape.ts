import type { PathAnchor } from '../path/path';

export type ShapeMode = 'rectangle' | 'ellipse' | 'polygon';
export type ShapeOutput = 'pixels' | 'path';

const KAPPA = 0.5522847498;

/** Approximate an ellipse as a closed cubic Bezier path with 4 anchors. */
export function ellipseToPathAnchors(cx: number, cy: number, rx: number, ry: number): PathAnchor[] {
  return [
    {
      point: { x: cx, y: cy - ry },
      handleIn: { x: cx - rx * KAPPA, y: cy - ry },
      handleOut: { x: cx + rx * KAPPA, y: cy - ry },
    },
    {
      point: { x: cx + rx, y: cy },
      handleIn: { x: cx + rx, y: cy - ry * KAPPA },
      handleOut: { x: cx + rx, y: cy + ry * KAPPA },
    },
    {
      point: { x: cx, y: cy + ry },
      handleIn: { x: cx + rx * KAPPA, y: cy + ry },
      handleOut: { x: cx - rx * KAPPA, y: cy + ry },
    },
    {
      point: { x: cx - rx, y: cy },
      handleIn: { x: cx - rx, y: cy + ry * KAPPA },
      handleOut: { x: cx - rx, y: cy - ry * KAPPA },
    },
  ];
}

/** Create a closed polygon path with N corner anchors (straight segments). */
export function polygonToPathAnchors(cx: number, cy: number, rx: number, ry: number, sides: number): PathAnchor[] {
  const n = Math.max(3, Math.round(sides));
  const anchors: PathAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    anchors.push({
      point: { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) },
      handleIn: null,
      handleOut: null,
    });
  }
  return anchors;
}

function cornerAnchor(x: number, y: number): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

/**
 * Closed path for the axis-aligned rectangle centred on (cx, cy) with half
 * extents (rx, ry). A positive corner radius (capped at the shorter half
 * extent) rounds each corner with a quarter-circle cubic.
 */
export function rectangleToPathAnchors(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cornerRadius: number,
): PathAnchor[] {
  const x0 = cx - rx;
  const x1 = cx + rx;
  const y0 = cy - ry;
  const y1 = cy + ry;
  const r = Math.max(0, Math.min(cornerRadius, rx, ry));
  if (r === 0) {
    return [cornerAnchor(x0, y0), cornerAnchor(x1, y0), cornerAnchor(x1, y1), cornerAnchor(x0, y1)];
  }

  const k = r * KAPPA;
  // Pairs of anchors bound each straight edge, clockwise from the top edge.
  const edges: Array<[PathAnchor, PathAnchor]> = [
    [
      { point: { x: x0 + r, y: y0 }, handleIn: { x: x0 + r - k, y: y0 }, handleOut: null },
      { point: { x: x1 - r, y: y0 }, handleIn: null, handleOut: { x: x1 - r + k, y: y0 } },
    ],
    [
      { point: { x: x1, y: y0 + r }, handleIn: { x: x1, y: y0 + r - k }, handleOut: null },
      { point: { x: x1, y: y1 - r }, handleIn: null, handleOut: { x: x1, y: y1 - r + k } },
    ],
    [
      { point: { x: x1 - r, y: y1 }, handleIn: { x: x1 - r + k, y: y1 }, handleOut: null },
      { point: { x: x0 + r, y: y1 }, handleIn: null, handleOut: { x: x0 + r - k, y: y1 } },
    ],
    [
      { point: { x: x0, y: y1 - r }, handleIn: { x: x0, y: y1 - r + k }, handleOut: null },
      { point: { x: x0, y: y0 + r }, handleIn: null, handleOut: { x: x0, y: y0 + r - k } },
    ],
  ];

  const anchors: PathAnchor[] = [];
  for (const [start, end] of edges) {
    // When the radius eats a whole side (a stadium or circle) the edge has no
    // length; two anchors on one point would leave a zero-length segment.
    const isDegenerate = Math.abs(start.point.x - end.point.x) < 1e-6
      && Math.abs(start.point.y - end.point.y) < 1e-6;
    if (isDegenerate) {
      anchors.push({ point: start.point, handleIn: start.handleIn, handleOut: end.handleOut });
    } else {
      anchors.push(start, end);
    }
  }
  return anchors;
}
