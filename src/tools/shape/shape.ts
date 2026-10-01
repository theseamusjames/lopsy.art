import type { Point } from '../../types';
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

/**
 * The regular polygon `shape_fill.glsl`'s `sdPolygon` draws for a drag box
 * centred on (cx, cy) with half extents (rx, ry). Vertex k sits at
 * `centre + r × (sin a, cos a)` for the angles listed here (y points down).
 */
export interface RegularPolygonFit {
  readonly centre: Point;
  readonly circumR: number;
  /** Vertex angles, clockwise on screen, starting at the top-most (then left-most) vertex. */
  readonly angles: readonly number[];
  /** Distance from the centre to each edge: circumR × cos(π / n). */
  readonly faceR: number;
}

/**
 * Mirrors sdPolygon's fit: even n get a flat top edge, odd n a top vertex;
 * the polygon is scaled until it fits the box on its tighter axis, and
 * shifted so its vertex bounding box (not its centroid) is centred.
 */
export function fitRegularPolygon(cx: number, cy: number, rx: number, ry: number, sides: number): RegularPolygonFit {
  const n = Math.max(3, Math.round(sides));
  const an = Math.PI / n;
  const rot = n % 2 === 0 ? an : Math.PI;

  let xMaxUnit = 0;
  let yMaxUnit = -1;
  let yMinUnit = 1;
  for (let i = 0; i < n; i++) {
    const a = rot + 2 * Math.PI * i / n;
    xMaxUnit = Math.max(xMaxUnit, Math.abs(Math.sin(a)));
    yMaxUnit = Math.max(yMaxUnit, Math.cos(a));
    yMinUnit = Math.min(yMinUnit, Math.cos(a));
  }
  const circumR = Math.min(rx / Math.max(xMaxUnit, 1e-6), (2 * ry) / Math.max(yMaxUnit - yMinUnit, 1e-6));
  const yShift = (yMaxUnit + yMinUnit) * 0.5 * circumR;
  const centre = { x: cx, y: cy - yShift };

  // Decreasing angle walks clockwise on screen.
  const raw: number[] = [];
  for (let i = 0; i < n; i++) raw.push(rot - 2 * Math.PI * i / n);
  let start = 0;
  let startY = Infinity;
  let startX = Infinity;
  raw.forEach((a, i) => {
    const y = Math.cos(a);
    const x = Math.sin(a);
    if (y < startY - 1e-9 || (Math.abs(y - startY) <= 1e-9 && x < startX)) {
      start = i;
      startY = y;
      startX = x;
    }
  });
  const angles = raw.slice(start).concat(raw.slice(0, start));
  return { centre, circumR, angles, faceR: circumR * Math.cos(an) };
}

function polar(centre: Point, r: number, a: number): Point {
  return { x: centre.x + r * Math.sin(a), y: centre.y + r * Math.cos(a) };
}

/**
 * Closed path matching the Pixels output of the same polygon drag: the
 * regular polygon sdPolygon fits to the box, with Corner Radius rounding
 * each vertex by a circular arc (the shader's inset-then-offset rounding,
 * capped like the shader at 99% of the apothem).
 */
export function polygonToPathAnchors(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  cornerRadius = 0,
): PathAnchor[] {
  const fit = fitRegularPolygon(cx, cy, rx, ry, sides);
  const n = fit.angles.length;
  const an = Math.PI / n;
  const r = Math.max(0, Math.min(cornerRadius, rx, ry, fit.faceR * 0.99));
  if (r === 0) {
    return fit.angles.map((a) => ({ point: polar(fit.centre, fit.circumR, a), handleIn: null, handleOut: null }));
  }

  const insetR = (fit.faceR - r) / Math.cos(an);
  // One cubic per ≤ 90° of arc keeps the circle error under 0.03% of r.
  const segments = Math.ceil((2 * an) / (Math.PI / 2) - 1e-9);
  const step = (2 * an) / segments;
  const h = (4 / 3) * Math.tan(step / 4) * r;
  // Clockwise travel direction along an arc at parameter φ (φ decreasing).
  const tangent = (phi: number): Point => ({ x: -Math.cos(phi), y: Math.sin(phi) });

  const anchors: PathAnchor[] = [];
  for (const a of fit.angles) {
    const arcCentre = polar(fit.centre, insetR, a);
    for (let s = 0; s <= segments; s++) {
      const phi = a + an - s * step;
      const point = polar(arcCentre, r, phi);
      const t = tangent(phi);
      anchors.push({
        point,
        handleIn: s === 0 ? null : { x: point.x - h * t.x, y: point.y - h * t.y },
        handleOut: s === segments ? null : { x: point.x + h * t.x, y: point.y + h * t.y },
      });
    }
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
