export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a layer texture must sit after `rotateLayer90` so its *content*
 * turns in place about the content's own centre (#969), rather than about
 * the texture's centre — which for an expanded layer is the canvas centre.
 *
 * `texture` is the layer's current texture rect in document space and
 * `content` the opaque-content rect in texture-local coordinates. The engine
 * rotates the whole texture, so a CW turn maps local (x, y) → (H − y, x) and a
 * CCW turn maps (x, y) → (y, W − x).
 *
 * When the content's width and height differ by an odd amount its centre
 * falls on a half pixel; CW rounds down and CCW rounds up so CW then CCW
 * lands back exactly where it started.
 */
export function rotatedTextureOrigin(
  texture: Rect,
  content: Rect,
  direction: 'cw' | 'ccw',
): { x: number; y: number } {
  const round = direction === 'cw' ? Math.floor : Math.ceil;
  const contentDocX = texture.x + content.x;
  const contentDocY = texture.y + content.y;
  const rotatedContentDocX = contentDocX + round((content.width - content.height) / 2);
  const rotatedContentDocY = contentDocY + round((content.height - content.width) / 2);

  const rotatedLocalX = direction === 'cw'
    ? texture.height - (content.y + content.height)
    : content.y;
  const rotatedLocalY = direction === 'cw'
    ? content.x
    : texture.width - (content.x + content.width);

  return { x: rotatedContentDocX - rotatedLocalX, y: rotatedContentDocY - rotatedLocalY };
}
