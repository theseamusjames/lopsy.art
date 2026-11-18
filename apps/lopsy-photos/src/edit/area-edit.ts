/**
 * Dragging an area's handles, in document pixels (pure). The Edit view
 * converts the pointer to document pixels and the result back to the
 * recipe's source-normalized geometry (engine/areas.ts).
 */

import type { Area } from '@lopsy/photos-core/library/recipe';
import type { DocEllipse, Point } from '../engine/areas';

export type LinearHandle = 'move' | 'start' | 'end';
export type RadialHandle = 'move' | 'radiusX' | 'radiusY' | 'rotate' | 'feather';

export interface DocLinear {
  readonly p0: Point;
  readonly p1: Point;
}

/** Smallest radius a drag leaves, in document pixels. */
export const MIN_RADIUS = 2;

export function dragLinear(start: DocLinear, handle: LinearHandle, from: Point, to: Point): DocLinear {
  if (handle === 'start') return { p0: to, p1: start.p1 };
  if (handle === 'end') return { p0: start.p0, p1: to };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { p0: { x: start.p0.x + dx, y: start.p0.y + dy }, p1: { x: start.p1.x + dx, y: start.p1.y + dy } };
}

/** The ellipse's own axes as unit vectors. */
export function ellipseAxes(e: DocEllipse): { u: Point; v: Point } {
  const t = (e.angle * Math.PI) / 180;
  return { u: { x: Math.cos(t), y: Math.sin(t) }, v: { x: -Math.sin(t), y: Math.cos(t) } };
}

export interface RadialDrag {
  readonly ellipse: DocEllipse;
  /** 0..100. */
  readonly feather: number;
}

export function dragRadial(start: RadialDrag, handle: RadialHandle, from: Point, to: Point): RadialDrag {
  const e = start.ellipse;
  const { u, v } = ellipseAxes(e);
  const rel = { x: to.x - e.cx, y: to.y - e.cy };
  const along = (axis: Point) => rel.x * axis.x + rel.y * axis.y;
  switch (handle) {
    case 'move':
      return { ...start, ellipse: { ...e, cx: e.cx + to.x - from.x, cy: e.cy + to.y - from.y } };
    case 'radiusX':
      return { ...start, ellipse: { ...e, rx: Math.max(MIN_RADIUS, Math.abs(along(u))) } };
    case 'radiusY':
      return { ...start, ellipse: { ...e, ry: Math.max(MIN_RADIUS, Math.abs(along(v))) } };
    case 'rotate': {
      if (rel.x === 0 && rel.y === 0) return start;
      return { ...start, ellipse: { ...e, angle: (Math.atan2(rel.y, rel.x) * 180) / Math.PI } };
    }
    case 'feather': {
      const inner = Math.min(1, Math.abs(along(v)) / Math.max(MIN_RADIUS, e.ry));
      return { ...start, feather: Math.round(Math.min(100, Math.max(0, (1 - inner) * 100))) };
    }
  }
}

/** The name an area shows: its own, or "Area 2" by its place in the list. */
export function areaLabel(area: Area, index: number): string {
  return area.name.trim() || `Area ${index + 1}`;
}

/** The adjustment sliders an area shows (local contrast is not rendered per area yet). */
export const AREA_SLIDERS = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'tint', label: 'Tint' },
  { key: 'saturation', label: 'Saturation' },
] as const;
