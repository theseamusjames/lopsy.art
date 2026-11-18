/**
 * Areas (spec 5.4): the recipe stores each area's geometry normalized to
 * the unrotated (oriented) source image, like the crop; the engine takes
 * it in document pixels (`setImageAreas`, 16 floats per area, layout in
 * engine/core/src/areas.rs). These functions map between the two through
 * the framing the engine applies: quarter turns and the mirror
 * (`effectiveFraming`), the straighten angle about the framed image's
 * centre, then the crop, whose corner is the document's origin.
 *
 * All pixel sizes are the engine's current ones (a working-size image may
 * be smaller than the file), so the map is rebuilt whenever they change.
 */

import type { Area, AreaAdjustments, LinearGeometry, RadialGeometry } from '@lopsy/photos-core/library/recipe';
import type { Framing } from './recipe-to-adjustments';

/** Floats per area in `setImageAreas`. */
export const AREA_STRIDE = 16;
/** Most areas the engine applies. */
export const ENGINE_MAX_AREAS = 8;

/** How the source image becomes the document, in the engine's current pixels. */
export interface AreaFrame {
  /** The oriented source image, before framing. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Quarter turns and mirror, as the engine applies them. */
  readonly framing: Framing;
  /** Straighten, degrees, clockwise on screen, about the framed image's centre. */
  readonly angle: number;
  /** The crop's top-left in framed-image pixels: the document's origin. */
  readonly cropX: number;
  readonly cropY: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

function framedSize(frame: AreaFrame): { width: number; height: number } {
  const isTurned = frame.framing.rotate === 90 || frame.framing.rotate === 270;
  return isTurned ? { width: frame.sourceHeight, height: frame.sourceWidth } : { width: frame.sourceWidth, height: frame.sourceHeight };
}

/** Quarter turn of a normalized point, clockwise (as crop.ts turns rectangles). */
function turn(x: number, y: number, rotate: Framing['rotate']): [number, number] {
  if (rotate === 90) return [1 - y, x];
  if (rotate === 180) return [1 - x, 1 - y];
  if (rotate === 270) return [y, 1 - x];
  return [x, y];
}

function unturn(x: number, y: number, rotate: Framing['rotate']): [number, number] {
  return turn(x, y, rotate === 90 ? 270 : rotate === 270 ? 90 : rotate);
}

function rotateAbout(p: Point, c: Point, angleDeg: number): Point {
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** A source-normalized point in document pixels. */
export function sourceToDocument(u: number, v: number, frame: AreaFrame): Point {
  const [tx, ty] = turn(u, v, frame.framing.rotate);
  const fx = frame.framing.flipH ? 1 - tx : tx;
  const size = framedSize(frame);
  const framed = { x: fx * size.width, y: ty * size.height };
  const turned = rotateAbout(framed, { x: size.width / 2, y: size.height / 2 }, frame.angle);
  return { x: turned.x - frame.cropX, y: turned.y - frame.cropY };
}

/** A document-pixel point back in source-normalized coordinates. */
export function documentToSource(x: number, y: number, frame: AreaFrame): Point {
  const size = framedSize(frame);
  const framed = rotateAbout({ x: x + frame.cropX, y: y + frame.cropY }, { x: size.width / 2, y: size.height / 2 }, -frame.angle);
  const fx = framed.x / size.width;
  const fy = framed.y / size.height;
  const [u, v] = unturn(frame.framing.flipH ? 1 - fx : fx, fy, frame.framing.rotate);
  return { x: u, y: v };
}

/** A source-pixel direction (no translation) in document pixels. */
function mapDirection(dx: number, dy: number, frame: AreaFrame): Point {
  const o = sourceToDocument(0.5, 0.5, frame);
  const p = sourceToDocument(0.5 + dx / frame.sourceWidth, 0.5 + dy / frame.sourceHeight, frame);
  return { x: p.x - o.x, y: p.y - o.y };
}

/** A radial area in document pixels: centre, radii and rotation (radians, y down). */
export interface DocumentEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
}

export function ellipseToDocument(g: RadialGeometry, frame: AreaFrame): DocumentEllipse {
  const c = sourceToDocument(g.cx, g.cy, frame);
  const t = (g.angle * Math.PI) / 180;
  const rxPx = g.rx * frame.sourceWidth;
  // The x axis of the ellipse, in source pixels, then through the framing.
  const axis = mapDirection(Math.cos(t) * rxPx, Math.sin(t) * rxPx, frame);
  return { cx: c.x, cy: c.y, rx: Math.hypot(axis.x, axis.y), ry: g.ry * frame.sourceHeight, rotation: Math.atan2(axis.y, axis.x) };
}

/** The inverse of `ellipseToDocument`: a document ellipse as the recipe stores it (feather kept). */
export function ellipseFromDocument(e: DocumentEllipse, feather: number, frame: AreaFrame): RadialGeometry {
  const c = documentToSource(e.cx, e.cy, frame);
  const a = documentToSource(e.cx + Math.cos(e.rotation) * e.rx, e.cy + Math.sin(e.rotation) * e.rx, frame);
  const dx = (a.x - c.x) * frame.sourceWidth;
  const dy = (a.y - c.y) * frame.sourceHeight;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    cx: c.x,
    cy: c.y,
    rx: Math.hypot(dx, dy) / frame.sourceWidth,
    ry: e.ry / frame.sourceHeight,
    angle: Math.round(angle * 10) / 10,
    feather,
  };
}

/** A linear area's two points in document pixels: full effect at `a`, none at `b`. */
export function lineToDocument(g: LinearGeometry, frame: AreaFrame): { a: Point; b: Point } {
  return { a: sourceToDocument(g.x0, g.y0, frame), b: sourceToDocument(g.x1, g.y1, frame) };
}

export function lineFromDocument(a: Point, b: Point, frame: AreaFrame): LinearGeometry {
  const p0 = documentToSource(a.x, a.y, frame);
  const p1 = documentToSource(b.x, b.y, frame);
  return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}

const ENGINE_ADJUSTMENTS: readonly (keyof AreaAdjustments)[] = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'temperature',
  'tint',
  'saturation',
];

/**
 * `setImageAreas`' floats for `areas` (oldest first, at most eight).
 * Pixel centres are at +0.5, so a source point maps straight to the
 * document coordinate the shader compares against.
 */
export function areaFloats(areas: readonly Area[], frame: AreaFrame): Float32Array {
  const shown = areas.slice(0, ENGINE_MAX_AREAS);
  const out = new Float32Array(shown.length * AREA_STRIDE);
  shown.forEach((area, i) => {
    const o = i * AREA_STRIDE;
    out[o] = area.kind === 'radial' ? 1 : 0;
    out[o + 1] = area.invert ? 1 : 0;
    out[o + 2] = Math.max(0, Math.min(1, area.amount / 100));
    if (area.kind === 'radial') {
      const e = ellipseToDocument(area.geometry, frame);
      out.set([e.cx, e.cy, e.rx, e.ry, e.rotation, Math.max(0, Math.min(1, area.geometry.feather / 100))], o + 3);
    } else {
      const { a, b } = lineToDocument(area.geometry, frame);
      out.set([a.x, a.y, b.x, b.y, 0, 0], o + 3);
    }
    ENGINE_ADJUSTMENTS.forEach((key, k) => {
      out[o + 9 + k] = area.adjustments[key];
    });
  });
  return out;
}
