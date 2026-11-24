/**
 * Areas (spec 5.4) between the recipe and the engine. The recipe keeps an
 * area's geometry normalized to the unrotated source image, like the crop;
 * the engine (`setImageAreas`) wants document pixels. The document is the
 * source turned by Rotate, mirrored by Flip, straightened about its centre
 * and cropped, so a point goes through the same steps as the crop and back.
 */

import { liveAreas, type Area, type LinearGeometry, type RadialGeometry, type Recipe } from '@lopsy/photos-core/library/recipe';
import { colorGradeValues, colorMixerValues, curvesLut } from './color-controls';
import { isIdentityCurves } from './curves';
import { curvesKey, developAreaLookValues, developCurvesValues } from './develop-stages';
import { detailValues, localContrastValues } from './detail-controls';
import { finishValues } from './finish-controls';
import type { Framing } from './recipe-to-adjustments';

/** Where the document sits relative to the source image. */
export interface AreaFrame {
  /** Rotate and Flip as the texture operations see them (`effectiveFraming`). */
  readonly framing: Framing;
  /** Straighten, degrees, clockwise on screen. */
  readonly angle: number;
  /** The working source image, oriented, before Rotate. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** The crop's top-left in framed pixels: the document's origin. */
  readonly cropX: number;
  readonly cropY: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Floats per area in `setImageAreas`. */
export const AREA_FLOATS = 16;

function framedSize(frame: AreaFrame): { width: number; height: number } {
  const isQuarter = frame.framing.rotate === 90 || frame.framing.rotate === 270;
  return isQuarter
    ? { width: frame.sourceHeight, height: frame.sourceWidth }
    : { width: frame.sourceWidth, height: frame.sourceHeight };
}

function rotateNormalized(p: Point, rotate: number): Point {
  if (rotate === 90) return { x: 1 - p.y, y: p.x };
  if (rotate === 180) return { x: 1 - p.x, y: 1 - p.y };
  if (rotate === 270) return { x: p.y, y: 1 - p.x };
  return p;
}

function turn(p: Point, centre: Point, degrees: number): Point {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c };
}

/** A source-normalized point in document pixels. */
export function sourceToDoc(p: Point, frame: AreaFrame): Point {
  const r = rotateNormalized(p, frame.framing.rotate);
  const f = frame.framing.flipH ? { x: 1 - r.x, y: r.y } : r;
  const size = framedSize(frame);
  const px = { x: f.x * size.width, y: f.y * size.height };
  const straight = turn(px, { x: size.width / 2, y: size.height / 2 }, frame.angle);
  return { x: straight.x - frame.cropX, y: straight.y - frame.cropY };
}

/** A document pixel back in source-normalized coordinates. */
export function docToSource(p: Point, frame: AreaFrame): Point {
  const size = framedSize(frame);
  const framedPx = turn({ x: p.x + frame.cropX, y: p.y + frame.cropY }, { x: size.width / 2, y: size.height / 2 }, -frame.angle);
  const f = { x: framedPx.x / size.width, y: framedPx.y / size.height };
  const r = frame.framing.flipH ? { x: 1 - f.x, y: f.y } : f;
  const back = frame.framing.rotate === 90 ? 270 : frame.framing.rotate === 270 ? 90 : frame.framing.rotate;
  return rotateNormalized(r, back);
}

function normalizeDegrees(d: number): number {
  let a = ((d + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/** An ellipse's turn in the document from its turn on the source. */
export function docAngle(sourceAngle: number, frame: AreaFrame): number {
  const turned = sourceAngle + frame.framing.rotate;
  return normalizeDegrees((frame.framing.flipH ? -turned : turned) + frame.angle);
}

/** The inverse of `docAngle`. */
export function sourceAngle(docAngleDeg: number, frame: AreaFrame): number {
  const unstraightened = docAngleDeg - frame.angle;
  const turned = frame.framing.flipH ? -unstraightened : unstraightened;
  return normalizeDegrees(turned - frame.framing.rotate);
}

/** A radial area in document pixels: centre, radii along its own axes, turn in degrees. */
export interface DocEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
}

export function radialToDoc(g: RadialGeometry, frame: AreaFrame): DocEllipse {
  const c = sourceToDoc({ x: g.cx, y: g.cy }, frame);
  return { cx: c.x, cy: c.y, rx: g.rx * frame.sourceWidth, ry: g.ry * frame.sourceHeight, angle: docAngle(g.angle, frame) };
}

export function radialFromDoc(e: DocEllipse, feather: number, frame: AreaFrame): RadialGeometry {
  const c = docToSource({ x: e.cx, y: e.cy }, frame);
  return {
    cx: c.x,
    cy: c.y,
    rx: Math.max(0.005, e.rx / frame.sourceWidth),
    ry: Math.max(0.005, e.ry / frame.sourceHeight),
    angle: sourceAngle(e.angle, frame),
    feather,
  };
}

export function linearToDoc(g: LinearGeometry, frame: AreaFrame): { p0: Point; p1: Point } {
  return { p0: sourceToDoc({ x: g.x0, y: g.y0 }, frame), p1: sourceToDoc({ x: g.x1, y: g.y1 }, frame) };
}

export function linearFromDoc(p0: Point, p1: Point, frame: AreaFrame): LinearGeometry {
  const a = docToSource(p0, frame);
  const b = docToSource(p1, frame);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

function areaFloats(area: Area, frame: AreaFrame): number[] {
  const adj = area.adjustments;
  const tail = [adj.exposure, adj.contrast, adj.highlights, adj.shadows, adj.temperature, adj.tint, adj.saturation];
  const head = [area.kind === 'linear' ? 0 : 1, area.invert ? 1 : 0, Math.min(1, Math.max(0, area.amount / 100))];
  if (area.kind === 'linear') {
    const { p0, p1 } = linearToDoc(area.geometry, frame);
    return [...head, p0.x, p0.y, p1.x, p1.y, 0, 0, ...tail];
  }
  const e = radialToDoc(area.geometry, frame);
  return [...head, e.cx, e.cy, e.rx, e.ry, (e.angle * Math.PI) / 180, area.geometry.feather / 100, ...tail];
}

/**
 * What an area's layer is given (`setImageArea…`): the area's own effects,
 * each compiled as the photo's own are, and null where it has none.
 */
export interface AreaLayerValues {
  /** Whites, blacks and vibrance. */
  readonly tone: readonly [number, number, number] | null;
  readonly curves: Uint8Array | null;
  readonly mixer: Float32Array | null;
  readonly grade: Float32Array | null;
  readonly detail: Float32Array | null;
  readonly localContrast: Float32Array | null;
  readonly finish: Float32Array | null;
}

export interface AreaLayerOptions {
  /** Working width over full width, for the effects measured in pixels. */
  readonly pixelScale: number;
  /** The photo's grain seed. */
  readonly grainSeed: number;
  /** While a slider is dragged the blurred passes are left out, as the photo's own are. */
  readonly isInteractive: boolean;
}

/** An area's layer, or null when its effects change nothing and it draws none. */
export function areaLayerValues(area: Area, options: AreaLayerOptions): AreaLayerValues | null {
  const fx = area.effects;
  const { whites, blacks } = fx.tone;
  const { vibrance } = fx.color;
  const values: AreaLayerValues = {
    tone: whites === 0 && blacks === 0 && vibrance === 0 ? null : [whites, blacks, vibrance],
    curves: curvesLut(fx),
    mixer: colorMixerValues(fx),
    grade: colorGradeValues(fx),
    detail: options.isInteractive ? null : detailValues(fx, options.pixelScale),
    localContrast: options.isInteractive ? null : localContrastValues(fx, options.pixelScale),
    finish: finishValues(fx.finish, options.grainSeed, options.pixelScale),
  };
  return Object.values(values).every((v) => v === null) ? null : values;
}

/** Changes whenever the layer must be set again; '' for no layer. */
export function areaLayerKey(values: AreaLayerValues | null): string {
  if (!values) return '';
  return Object.values(values)
    .map((v: ArrayLike<number> | null) => (v ? Array.from(v).join(',') : ''))
    .join('|');
}

/**
 * An area's layer on the linear path (develop-stages.ts): its look and
 * curves for `setDevelopAreaLook` and `setDevelopAreaCurves`, and the same
 * detail, local contrast and finish as the legacy path. The curves are keyed
 * by their points and built only when the layer is sent.
 */
export interface LinearAreaLayerValues {
  readonly look: Float32Array | null;
  /** '' when every curve is the identity. */
  readonly curvesKey: string;
  readonly curves: () => Float32Array | null;
  readonly detail: Float32Array | null;
  readonly localContrast: Float32Array | null;
  readonly finish: Float32Array | null;
}

/** An area's linear layer, or null when its effects change nothing and it draws none. */
export function linearAreaLayerValues(area: Area, options: AreaLayerOptions): LinearAreaLayerValues | null {
  const fx = area.effects;
  const hasCurves = developCurvesNeeded(fx);
  const values: LinearAreaLayerValues = {
    look: developAreaLookValues(fx),
    curvesKey: hasCurves ? curvesKey(fx) : '',
    curves: () => (hasCurves ? developCurvesValues(fx) : null),
    detail: options.isInteractive ? null : detailValues(fx, options.pixelScale),
    localContrast: options.isInteractive ? null : localContrastValues(fx, options.pixelScale),
    finish: finishValues(fx.finish, options.grainSeed, options.pixelScale),
  };
  const isEmpty = !values.look && !hasCurves && !values.detail && !values.localContrast && !values.finish;
  return isEmpty ? null : values;
}

/** `areaLayerKey` for the linear path; '' for no layer. */
export function linearAreaLayerKey(values: LinearAreaLayerValues | null): string {
  if (!values) return '';
  const list = (v: Float32Array | null) => (v ? Array.from(v).join(',') : '');
  return [list(values.look), values.curvesKey, list(values.detail), list(values.localContrast), list(values.finish)].join('|');
}

function developCurvesNeeded(fx: Recipe): boolean {
  const c = fx.curves;
  return !isIdentityCurves({ rgb: c.luminance, r: c.red, g: c.green, b: c.blue });
}

/**
 * The block `setImageAreas` takes for the recipe's live areas, in creation
 * order (every live one, so `ids` gives the index the mask overlay
 * takes); null when there is none.
 */
export function areaValues(recipe: Recipe, frame: AreaFrame): { values: Float32Array; ids: string[] } | null {
  const areas = liveAreas(recipe);
  if (areas.length === 0) return null;
  return { values: Float32Array.from(areas.flatMap((a) => areaFloats(a, frame))), ids: areas.map((a) => a.id) };
}
