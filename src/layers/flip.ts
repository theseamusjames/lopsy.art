import type { Rect } from './rotate-90';

export type FlipAxis = 'horizontal' | 'vertical';

/** Smallest rect covering every rect in `rects`; null when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where a layer texture must sit after `flipLayer` so its content ends up
 * mirrored about the centre line of `bounds` rather than about the texture's
 * own centre.
 *
 * The engine mirrors a texture within itself: local column `u` of a `W`-wide
 * texture becomes `W − 1 − u`. Moving the texture's left edge to
 * `2·bounds.x + bounds.width − (texture.x + W)` then sends every document
 * column `p` to `2·bounds.x + bounds.width − 1 − p`, the mirror of `p` in
 * `bounds`. All inputs are whole pixels, so the result is too.
 */
export function mirroredTextureOrigin(
  texture: Rect,
  bounds: Rect,
  axis: FlipAxis,
): { x: number; y: number } {
  if (axis === 'horizontal') {
    return { x: 2 * bounds.x + bounds.width - (texture.x + texture.width), y: texture.y };
  }
  return { x: texture.x, y: 2 * bounds.y + bounds.height - (texture.y + texture.height) };
}

/**
 * A layer to be flipped as part of a group: its texture rect in document
 * space and its opaque-content rect local to that texture (null when empty).
 */
export interface GroupFlipMember {
  id: string;
  texture: Rect;
  content: Rect | null;
}

/**
 * New texture origins for flipping a group as a unit: every member with
 * content is mirrored about the union of the members' document-space
 * content rects, so the group's visible extent stays where it was. Empty
 * members are left out — they have nothing to mirror.
 */
export function planGroupFlip(
  members: readonly GroupFlipMember[],
  axis: FlipAxis,
): Map<string, { x: number; y: number }> {
  const withContent = members.filter((m): m is GroupFlipMember & { content: Rect } =>
    m.content !== null && m.content.width > 0 && m.content.height > 0);
  const bounds = unionRects(withContent.map((m) => ({
    x: m.texture.x + m.content.x,
    y: m.texture.y + m.content.y,
    width: m.content.width,
    height: m.content.height,
  })));
  const origins = new Map<string, { x: number; y: number }>();
  if (!bounds) return origins;
  for (const m of withContent) origins.set(m.id, mirroredTextureOrigin(m.texture, bounds, axis));
  return origins;
}
