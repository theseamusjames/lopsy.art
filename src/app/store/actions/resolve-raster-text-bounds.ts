export interface RasterTextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pick the authoritative bounds for converting a text layer to a raster
 *  layer. After GPU operations such as `ensure_layer_full_size` (fill,
 *  gradient, brush…) the engine-side x/y/width/height can diverge from
 *  the JS-tracked values. When the engine reports valid bounds, those
 *  win; otherwise we fall back to the JS-tracked position combined with
 *  the texture dimensions. */
export function resolveRasterTextBounds(
  engineBounds: readonly number[] | Int32Array | null | undefined,
  fallbackX: number,
  fallbackY: number,
  fallbackWidth: number,
  fallbackHeight: number,
): RasterTextBounds | null {
  if (engineBounds && engineBounds.length === 4) {
    const w = engineBounds[2] ?? 0;
    const h = engineBounds[3] ?? 0;
    if (w > 0 && h > 0) {
      return {
        x: engineBounds[0] ?? 0,
        y: engineBounds[1] ?? 0,
        width: w,
        height: h,
      };
    }
  }
  if (fallbackWidth <= 0 || fallbackHeight <= 0) return null;
  return { x: fallbackX, y: fallbackY, width: fallbackWidth, height: fallbackHeight };
}
