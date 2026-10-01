import type { Layer, Point, Rect } from '../../types';
import { isGroupLayer } from '../../layers/group-utils';
import type { CornerOffsets, TransformState } from './transform';
import { getCornerPositions, getTransformedContentBounds } from './transform';
import { createTransformPointMapper } from './transform-point';

/**
 * Transforming several layers together (Move tool, no marquee). Every layer
 * goes through the same TransformState, whose `originalBounds` is the union
 * of their content — so they share one pivot (the union's centre) and keep
 * their arrangement, as if they were one picture.
 */

/**
 * Whether the Layers-panel selection asks for a multi-layer transform box:
 * two or more rows, or a group (which stands for its contents).
 */
export function selectionWantsLayerTransform(layers: readonly Layer[], selectedIds: readonly string[]): boolean {
  if (selectedIds.length >= 2) return true;
  return selectedIds.some((id) => {
    const layer = layers.find((l) => l.id === id);
    return layer !== undefined && isGroupLayer(layer);
  });
}

/**
 * The pixel layers a multi-layer transform moves: every selected layer, with
 * a group standing for its descendants. Locked layers stay put (as in a Move
 * drag), and so does everything inside a locked group. Document order, no
 * duplicates.
 */
export function resolveLayerTransformTargets(layers: readonly Layer[], selectedIds: readonly string[]): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const picked = new Set<string>();
  const visit = (id: string): void => {
    const layer = byId.get(id);
    if (!layer || layer.locked) return;
    if (isGroupLayer(layer)) {
      for (const child of layer.children) visit(child);
      return;
    }
    picked.add(id);
  };
  for (const id of selectedIds) visit(id);
  return layers.filter((l) => picked.has(l.id)).map((l) => l.id);
}

/** Smallest rect covering every rect; null for none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Document bounds of `rect` (one layer's content, inside
 * `t.originalBounds`) after the shared transform: where that layer's pixels
 * land. Falls back to the whole transformed box when a corner has no image
 * (a self-crossing perspective quad).
 */
export function transformedSubRectBounds(t: TransformState, rect: Rect): Rect {
  const map = createTransformPointMapper(t);
  const corners = [
    map(rect.x, rect.y),
    map(rect.x + rect.width, rect.y),
    map(rect.x + rect.width, rect.y + rect.height),
    map(rect.x, rect.y + rect.height),
  ];
  if (corners.some((c) => c === null)) return getTransformedContentBounds(t);
  const pts = corners.filter((c): c is NonNullable<typeof c> => c !== null);
  return unionRects(pts.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))) ?? getTransformedContentBounds(t);
}

const EDGE_TOLERANCE = 1e-6;

/**
 * Integer pixel rect covering `rect` plus one pixel of slack for the
 * bilinear edge of transformed content.
 */
export function pixelRectCovering(rect: Rect): Rect {
  // Trig leaves 1e-14-sized residue on edges that are exactly on a pixel
  // boundary (a 90° turn); without the tolerance it costs a pixel per side.
  const x = Math.floor(rect.x + EDGE_TOLERANCE) - 1;
  const y = Math.floor(rect.y + EDGE_TOLERANCE) - 1;
  const right = Math.ceil(rect.x + rect.width - EDGE_TOLERANCE) + 1;
  const bottom = Math.ceil(rect.y + rect.height - EDGE_TOLERANCE) + 1;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * `t` followed by a mirror about the centre of where `t` puts the content —
 * the flip buttons applied on top of a pending scale, rotate, skew or
 * corner drag.
 */
export function flipTransform(t: TransformState, axis: 'horizontal' | 'vertical'): TransformState {
  if (t.mode === 'distort' || t.mode === 'perspective') {
    const box = getTransformedContentBounds(t);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const mirrored = getCornerPositions(t).map((p) => (axis === 'horizontal'
      ? { x: 2 * cx - p.x, y: p.y }
      : { x: p.x, y: 2 * cy - p.y }));
    const [tl, tr, br, bl] = mirrored as [Point, Point, Point, Point];
    const ob = t.originalBounds;
    const right = ob.x + ob.width;
    const bottom = ob.y + ob.height;
    const corners: CornerOffsets = [
      { x: tl.x - ob.x, y: tl.y - ob.y },
      { x: tr.x - right, y: tr.y - ob.y },
      { x: br.x - right, y: br.y - bottom },
      { x: bl.x - ob.x, y: bl.y - bottom },
    ];
    return { ...t, corners };
  }
  // Mirror · R(θ) = R(−θ) · Mirror, and the mirror folds into the scale.
  return axis === 'horizontal'
    ? { ...t, rotation: -t.rotation, scaleX: -t.scaleX }
    : { ...t, rotation: -t.rotation, scaleY: -t.scaleY };
}

/**
 * `t` turned a further quarter turn about its centre. A box whose width and
 * height differ by an odd number of pixels has its turned edges on half
 * pixels; nudging it half a pixel (down for clockwise, up for
 * counter-clockwise, so the two undo each other) keeps an exact 90° turn on
 * the pixel grid instead of resampling every pixel.
 */
export function rotateTransform90(t: TransformState, direction: 'cw' | 'ccw'): TransformState {
  const turn = direction === 'cw' ? Math.PI / 2 : -Math.PI / 2;
  const ob = t.originalBounds;
  const isOddTurn = Math.abs(Math.round(ob.width) - Math.round(ob.height)) % 2 === 1;
  const shift = isOddTurn ? (direction === 'cw' ? -0.5 : 0.5) : 0;
  return {
    ...t,
    rotation: t.rotation + turn,
    translateX: t.translateX + shift,
    translateY: t.translateY + shift,
  };
}
