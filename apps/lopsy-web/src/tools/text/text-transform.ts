import type { Point, Rect, TextLayer, TextTransform } from '../../types';
import {
  createTransformState,
  documentAffineOf,
  type DocumentAffine,
  type TransformHandle,
  type TransformMode,
  type TransformState,
} from '../transform/transform';

/**
 * Linear part of a text transform, canvas `setTransform` convention:
 * `x' = a·x + c·y`, `y' = b·x + d·y`.
 */
export interface TextMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/**
 * Where a text layer's layout sits in the document: layout point `p` lands
 * at `matrix · p + anchor`. `box` is the layout box (union of line boxes) in
 * layout space, which the Move tool draws its handles around.
 */
export interface TextFrame {
  readonly anchor: Point;
  readonly matrix: TextMatrix;
  readonly box: Rect;
}

export const IDENTITY_MATRIX: TextMatrix = { a: 1, b: 0, c: 0, d: 1 };

const EPSILON = 1e-6;

/** Smallest |determinant| a text transform may have before it collapses the glyphs. */
const MIN_DETERMINANT = 1e-4;

/** Largest scale factor of a text transform (keeps the raster within engine limits). */
const MAX_SCALE = 64;

export function isIdentityMatrix(m: TextMatrix): boolean {
  return Math.abs(m.a - 1) < EPSILON && Math.abs(m.b) < EPSILON
    && Math.abs(m.c) < EPSILON && Math.abs(m.d - 1) < EPSILON;
}

export function matrixOf(t: TextTransform | undefined): TextMatrix {
  return t ? { a: t.a, b: t.b, c: t.c, d: t.d } : IDENTITY_MATRIX;
}

export function applyMatrix(m: TextMatrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

/** `l · r` — apply `r` first, then `l`. */
export function multiplyMatrix(l: TextMatrix, r: TextMatrix): TextMatrix {
  return {
    a: l.a * r.a + l.c * r.b,
    b: l.b * r.a + l.d * r.b,
    c: l.a * r.c + l.c * r.d,
    d: l.b * r.c + l.d * r.d,
  };
}

export function invertMatrix(m: TextMatrix): TextMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det };
}

/** Largest stretch the matrix applies in any direction (its top singular value). */
export function maxScaleOf(m: TextMatrix): number {
  const p = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
  const det = m.a * m.d - m.b * m.c;
  const disc = Math.sqrt(Math.max(0, p * p / 4 - det * det));
  return Math.sqrt(p / 2 + disc);
}

/**
 * True when the matrix is usable for placing text: invertible enough that the
 * glyphs keep some area, and no larger than the engine can rasterize.
 */
export function isUsableTextMatrix(m: TextMatrix): boolean {
  const det = m.a * m.d - m.b * m.c;
  if (![m.a, m.b, m.c, m.d].every(Number.isFinite)) return false;
  return Math.abs(det) >= MIN_DETERMINANT && maxScaleOf(m) <= MAX_SCALE;
}

/**
 * Raster density for rendering a transformed layer: glyphs are drawn upright
 * at twice the transform's largest stretch, so the resample into the document
 * only ever shrinks them (sharp edges, smooth rotation). Quantized so a
 * rotate drag keeps hitting the engine's cached layout.
 */
export function rasterScaleFor(m: TextMatrix): number {
  const target = 2 * maxScaleOf(m);
  return Math.min(16, Math.max(0.25, Math.ceil(target * 4) / 4));
}

/**
 * Where a text layer's texture landed after a re-render. A transformed layer
 * also gets its `transform` back, with the anchor re-expressed relative to
 * the new texture origin.
 */
export interface TextPlacement {
  x: number;
  y: number;
  transform?: TextTransform;
}

/** The layer fields a {@link TextPlacement} sets (and nothing else it may carry). */
export function placementProps(p: TextPlacement): Pick<TextLayer, 'x' | 'y'> & Partial<Pick<TextLayer, 'transform'>> {
  return p.transform ? { x: p.x, y: p.y, transform: p.transform } : { x: p.x, y: p.y };
}

/** Document-space anchor (layout origin) of a transformed text layer. */
export function textAnchorOf(layer: Pick<TextLayer, 'x' | 'y' | 'transform'>): Point | null {
  if (!layer.transform) return null;
  return { x: layer.x + layer.transform.anchorX, y: layer.y + layer.transform.anchorY };
}

/** The `TextTransform` that places `anchor` with `matrix` for a texture at (`x`, `y`). */
export function textTransformFor(matrix: TextMatrix, anchor: Point, x: number, y: number): TextTransform {
  return { ...matrix, anchorX: anchor.x - x, anchorY: anchor.y - y };
}

/** The four corners of the frame's layout box in document space (TL, TR, BR, BL). */
export function frameCorners(frame: TextFrame): [Point, Point, Point, Point] {
  const { box } = frame;
  const toDoc = (x: number, y: number): Point => {
    const p = applyMatrix(frame.matrix, { x, y });
    return { x: p.x + frame.anchor.x, y: p.y + frame.anchor.y };
  };
  return [
    toDoc(box.x, box.y),
    toDoc(box.x + box.width, box.y),
    toDoc(box.x + box.width, box.y + box.height),
    toDoc(box.x, box.y + box.height),
  ];
}

/** Map a document point into the frame's layout space. */
export function docToLayout(frame: Pick<TextFrame, 'anchor' | 'matrix'>, p: Point): Point | null {
  const inv = invertMatrix(frame.matrix);
  if (!inv) return null;
  return applyMatrix(inv, { x: p.x - frame.anchor.x, y: p.y - frame.anchor.y });
}

/**
 * True when document point `p` falls inside the frame's layout box, grown by
 * `slop` document pixels on every side.
 */
export function frameContains(frame: TextFrame, p: Point, slop: number): boolean {
  const local = docToLayout(frame, p);
  if (!local) return false;
  // Convert the document-space slop into layout units along each box axis.
  const sx = Math.hypot(frame.matrix.a, frame.matrix.b) || 1;
  const sy = Math.hypot(frame.matrix.c, frame.matrix.d) || 1;
  const { box } = frame;
  return local.x >= box.x - slop / sx && local.x <= box.x + box.width + slop / sx
    && local.y >= box.y - slop / sy && local.y <= box.y + box.height + slop / sy;
}

/**
 * Express a text frame as the Move tool's handle state. The layout box,
 * shifted to the anchor, is the untransformed rect; the matrix is factored
 * as rotation · scale · horizontal skew, which is exactly the chain the
 * handles drive (`forwardAffine2x2` / `transformPoint`).
 */
export function transformStateFromFrame(frame: TextFrame, mode: TransformMode = 'free'): TransformState {
  const { a, b, c, d } = frame.matrix;
  const rotation = Math.atan2(b, a);
  const scaleX = Math.hypot(a, b) || 1;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const skewTimesScale = c * cos + d * sin;
  const scaleY = -c * sin + d * cos;
  const skewX = Math.atan(skewTimesScale / scaleX);

  const bounds: Rect = {
    x: frame.anchor.x + frame.box.x,
    y: frame.anchor.y + frame.box.y,
    width: frame.box.width,
    height: frame.box.height,
  };
  // The handle chain spins the rect about its own centre; shift by
  // (M - I)·centre so the frame's anchor stays where the matrix puts it.
  const centre = { x: frame.box.x + frame.box.width / 2, y: frame.box.y + frame.box.height / 2 };
  const moved = applyMatrix(frame.matrix, centre);
  return {
    ...createTransformState(bounds, mode),
    rotation,
    scaleX,
    scaleY,
    skewX,
    skewY: 0,
    translateX: moved.x - centre.x,
    translateY: moved.y - centre.y,
  };
}

/**
 * Apply a document-space linear map `f` about `pivot` to a text placement:
 * the result places every glyph where `f` would move it on the canvas.
 * Used for Flip and Rotate 90° on text layers.
 */
export function applyDocumentLinear(
  placement: { anchor: Point; matrix: TextMatrix },
  f: TextMatrix,
  pivot: Point,
): { anchor: Point; matrix: TextMatrix } {
  const rel = applyMatrix(f, { x: placement.anchor.x - pivot.x, y: placement.anchor.y - pivot.y });
  return {
    anchor: { x: rel.x + pivot.x, y: rel.y + pivot.y },
    matrix: multiplyMatrix(f, placement.matrix),
  };
}

/**
 * Carry a text placement through a document-space affine map (the Move
 * tool's shared box over several layers or a group): every glyph lands where
 * `f` moves that point on the canvas. Composes with whatever matrix the text
 * already has, so a second turn adds to the first and a rotate after a
 * scale keeps the scale; the pivot is whatever `f` encodes.
 */
export function applyDocumentAffine(
  placement: { anchor: Point; matrix: TextMatrix },
  f: DocumentAffine,
): { anchor: Point; matrix: TextMatrix } {
  const linear: TextMatrix = { a: f.a, b: f.b, c: f.c, d: f.d };
  const moved = applyMatrix(linear, placement.anchor);
  return {
    anchor: { x: moved.x + f.e, y: moved.y + f.f },
    matrix: multiplyMatrix(linear, placement.matrix),
  };
}

/**
 * Where a multi-layer transform `t` puts a text layer that sat at
 * `placement` when the transform began, or null when `t` is not affine
 * (a Distort / Perspective corner drag) and no text matrix can follow it.
 */
export function placementThroughTransform(
  placement: { anchor: Point; matrix: TextMatrix },
  t: TransformState,
): { anchor: Point; matrix: TextMatrix } | null {
  const f = documentAffineOf(t);
  return f ? applyDocumentAffine(placement, f) : null;
}

/** Centre of the frame's layout box in document space. */
export function frameCentre(frame: TextFrame): Point {
  const { box } = frame;
  const p = applyMatrix(frame.matrix, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return { x: p.x + frame.anchor.x, y: p.y + frame.anchor.y };
}

export const FLIP_HORIZONTAL: TextMatrix = { a: -1, b: 0, c: 0, d: 1 };
export const FLIP_VERTICAL: TextMatrix = { a: 1, b: 0, c: 0, d: -1 };
/** A quarter turn clockwise on screen (y points down). */
export const ROTATE_CW: TextMatrix = { a: 0, b: 1, c: -1, d: 0 };
export const ROTATE_CCW: TextMatrix = { a: 0, b: -1, c: 1, d: 0 };

/**
 * Scale every length in an engine text-props JSON by `scale`, so the engine
 * lays the text out at that density. Line height is a multiplier and colour
 * and flags are unitless, so they stay put.
 */
export function scaleTextPropsJson(propsJson: string, scale: number): string {
  const props = JSON.parse(propsJson) as Record<string, unknown>;
  const scaleField = (key: string): void => {
    const v = props[key];
    if (typeof v === 'number') props[key] = v * scale;
  };
  scaleField('fontSize');
  scaleField('letterSpacing');
  scaleField('paragraphSpacing');
  scaleField('areaWidth');
  return JSON.stringify(props);
}

/** Smallest stretch a handle drag may leave along either box axis. */
const MIN_HANDLE_SCALE = 0.02;

/** Rotation snap step with ⌘ held: 15°. */
const ANGLE_SNAP = Math.PI / 12;

export interface TextHandleDragOptions {
  /** 'skew' turns edge handles into shears; corners still scale. */
  readonly mode: 'free' | 'skew';
  /** Corner drags keep the box's aspect ratio. */
  readonly isProportional: boolean;
  /** Rotation lands on 15° steps. */
  readonly shouldSnapAngle: boolean;
}

export function rotationMatrix(radians: number): TextMatrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos };
}

/** Keep a stretch factor's sign (a drag past the opposite edge flips) but not collapse to nothing. */
function clampStretch(f: number): number {
  if (!Number.isFinite(f)) return 1;
  if (Math.abs(f) >= MIN_HANDLE_SCALE) return f;
  return f < 0 ? -MIN_HANDLE_SCALE : MIN_HANDLE_SCALE;
}

/**
 * Compose `local` (a map in layout space) into the frame about layout point
 * `fixed`, which stays where it is in the document.
 */
function composeAbout(frame: TextFrame, local: TextMatrix, fixed: Point): { anchor: Point; matrix: TextMatrix } {
  const moved = applyMatrix(local, fixed);
  const shift = applyMatrix(frame.matrix, { x: fixed.x - moved.x, y: fixed.y - moved.y });
  return {
    anchor: { x: frame.anchor.x + shift.x, y: frame.anchor.y + shift.y },
    matrix: multiplyMatrix(frame.matrix, local),
  };
}

/**
 * The placement a Move-tool handle drag from `start` to `current` gives the
 * text in `frame`. Scale and skew are worked out in the text's own layout
 * space, so they follow the box's rotation, a flip or an earlier skew, and
 * the edge opposite the dragged handle stays put. Rotate handles turn the
 * text about the box centre.
 */
export function dragTextFrame(
  frame: TextFrame,
  handle: TransformHandle,
  start: Point,
  current: Point,
  options: TextHandleDragOptions,
): { anchor: Point; matrix: TextMatrix } | null {
  if (handle.startsWith('rotate-')) {
    const centre = frameCentre(frame);
    let delta = Math.atan2(current.y - centre.y, current.x - centre.x)
      - Math.atan2(start.y - centre.y, start.x - centre.x);
    if (options.shouldSnapAngle) {
      const base = Math.atan2(frame.matrix.b, frame.matrix.a);
      delta = Math.round((base + delta) / ANGLE_SNAP) * ANGLE_SNAP - base;
    }
    return applyDocumentLinear(frame, rotationMatrix(delta), centre);
  }

  const s = docToLayout(frame, start);
  const c = docToLayout(frame, current);
  if (!s || !c) return null;
  const { box } = frame;
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const movesLeft = handle.endsWith('left');
  const movesRight = handle.endsWith('right');
  const movesTop = handle.startsWith('top');
  const movesBottom = handle.startsWith('bottom');
  const isEdge = (movesLeft || movesRight) !== (movesTop || movesBottom);

  if (options.mode === 'skew' && isEdge) {
    if (movesLeft || movesRight) {
      // Slide the dragged side up or down; the opposite side holds.
      const fixedX = movesRight ? left : right;
      const span = (movesRight ? right : left) - fixedX;
      const k = span === 0 ? 0 : (c.y - s.y) / span;
      return composeAbout(frame, { a: 1, b: k, c: 0, d: 1 }, { x: fixedX, y: top });
    }
    const fixedY = movesBottom ? top : bottom;
    const span = (movesBottom ? bottom : top) - fixedY;
    const k = span === 0 ? 0 : (c.x - s.x) / span;
    return composeAbout(frame, { a: 1, b: 0, c: k, d: 1 }, { x: left, y: fixedY });
  }

  const fixedX = movesRight ? left : movesLeft ? right : (left + right) / 2;
  const fixedY = movesBottom ? top : movesTop ? bottom : (top + bottom) / 2;
  let fx = 1;
  let fy = 1;
  if (movesLeft || movesRight) {
    const edge = movesRight ? right : left;
    fx = clampStretch((edge + c.x - s.x - fixedX) / (edge - fixedX));
  }
  if (movesTop || movesBottom) {
    const edge = movesBottom ? bottom : top;
    fy = clampStretch((edge + c.y - s.y - fixedY) / (edge - fixedY));
  }
  if (options.isProportional && !isEdge) {
    const m = (Math.abs(fx) + Math.abs(fy)) / 2;
    fx = Math.sign(fx) * m;
    fy = Math.sign(fy) * m;
  }
  return composeAbout(frame, { a: fx, b: 0, c: 0, d: fy }, { x: fixedX, y: fixedY });
}
