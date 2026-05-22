export interface RasterBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve the document-space bounds for a layer about to be rasterized.
 *
 * The Rust engine treats the layer texture as authoritative: prior GPU
 * operations (ensure_layer_full_size, fill, brush, gradient, etc.) may have
 * expanded the texture and shifted the engine-side `desc.x` / `desc.y`
 * without notifying JS. Using the stale JS-side (jsX, jsY) for the new
 * raster layer would place it at the wrong document position — the
 * symptom reported in issue #496 (text appears to jump after rasterize).
 *
 * Prefer the engine bounds (`[x, y, w, h]`) when valid; fall back to JS
 * coordinates plus texture dimensions when the engine doesn't have a
 * record of this layer yet.
 */
export function resolveRasterTextBounds(
  jsX: number,
  jsY: number,
  engineBounds: ArrayLike<number>,
  textureDims: ArrayLike<number>,
): RasterBounds | null {
  const hasEngineBounds = engineBounds.length === 4;
  const hasEngineSize = hasEngineBounds && (engineBounds[2] ?? 0) > 0 && (engineBounds[3] ?? 0) > 0;
  if (hasEngineSize) {
    return {
      x: engineBounds[0]!,
      y: engineBounds[1]!,
      width: engineBounds[2]!,
      height: engineBounds[3]!,
    };
  }

  const texW = textureDims[0] ?? 0;
  const texH = textureDims[1] ?? 0;
  if (texW === 0 || texH === 0) return null;

  return {
    x: hasEngineBounds ? (engineBounds[0] ?? jsX) : jsX,
    y: hasEngineBounds ? (engineBounds[1] ?? jsY) : jsY,
    width: texW,
    height: texH,
  };
}
