import type { Rect } from '../../types';

export interface LayerTexture {
  readonly pixels: ArrayLike<number>;
  /** Document-space origin of the texture's top-left texel. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionPatternSource {
  readonly bounds: Rect;
  readonly mask: ArrayLike<number>;
  readonly maskWidth: number;
  readonly maskHeight: number;
}

export interface ExtractedPattern {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Cut the selected region of a layer out as pattern pixels. The selection
 * is in document space, while a moved or content-cropped layer's texture
 * starts at its own document origin, so every texel lookup is offset by
 * that origin (#1142). Areas of the selection outside the texture are
 * transparent.
 */
export function extractSelectionPattern(
  texture: LayerTexture,
  selection: SelectionPatternSource,
  docWidth: number,
  docHeight: number,
): ExtractedPattern | null {
  const { bounds, mask, maskWidth, maskHeight } = selection;
  const x0 = Math.max(0, Math.round(bounds.x));
  const y0 = Math.max(0, Math.round(bounds.y));
  const x1 = Math.min(docWidth, Math.round(bounds.x + bounds.width));
  const y1 = Math.min(docHeight, Math.round(bounds.y + bounds.height));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;

  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const docY = y0 + row;
    const texY = docY - texture.y;
    if (texY < 0 || texY >= texture.height) continue;
    for (let col = 0; col < width; col++) {
      const docX = x0 + col;
      const texX = docX - texture.x;
      if (texX < 0 || texX >= texture.width) continue;

      let maskVal = 0;
      if (docX < maskWidth && docY < maskHeight) {
        maskVal = (mask[docY * maskWidth + docX] ?? 0) / 255;
      }

      const srcIdx = (texY * texture.width + texX) * 4;
      const dstIdx = (row * width + col) * 4;
      data[dstIdx] = texture.pixels[srcIdx] ?? 0;
      data[dstIdx + 1] = texture.pixels[srcIdx + 1] ?? 0;
      data[dstIdx + 2] = texture.pixels[srcIdx + 2] ?? 0;
      data[dstIdx + 3] = Math.round((texture.pixels[srcIdx + 3] ?? 0) * maskVal);
    }
  }
  return { data, width, height };
}
