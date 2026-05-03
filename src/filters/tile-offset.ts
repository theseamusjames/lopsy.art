/**
 * Tile/Offset filter — shifts all pixels by (offsetX, offsetY) with optional
 * wrap-around. Useful for seamless tiling: shift the image so seams appear in
 * the center, paint over them, then shift back.
 *
 * Algorithm: for each output pixel at (x, y), sample from
 * ((x - offsetX) mod width, (y - offsetY) mod height) in the source.
 *
 * The wrap parameter controls edge behaviour:
 *   wrap = true  → toroidal wrap (modular arithmetic)
 *   wrap = false → exposed edges are filled with transparent black
 */

/** Positive modulo that always returns a value in [0, n). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Apply a tile offset to raw RGBA pixel data.
 * Works on plain typed arrays — no browser APIs needed.
 */
export function applyTileOffsetPixels(
  srcData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  wrap: boolean,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(width * height * 4);
  const ox = Math.round(offsetX);
  const oy = Math.round(offsetY);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = wrap ? mod(x - ox, width) : x - ox;
      const srcY = wrap ? mod(y - oy, height) : y - oy;

      const dstIdx = (y * width + x) * 4;

      if (!wrap && (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height)) {
        // Out of bounds in non-wrap mode → transparent black (dst already zeroed)
        continue;
      }

      const srcIdx = (srcY * width + srcX) * 4;
      dst[dstIdx] = srcData[srcIdx] ?? 0;
      dst[dstIdx + 1] = srcData[srcIdx + 1] ?? 0;
      dst[dstIdx + 2] = srcData[srcIdx + 2] ?? 0;
      dst[dstIdx + 3] = srcData[srcIdx + 3] ?? 0;
    }
  }

  return dst;
}

/**
 * Apply a tile offset to an ImageData, returning a new ImageData.
 * Used by the GPU filter pipeline after reading back layer pixels.
 */
export function applyTileOffset(
  src: ImageData,
  offsetX: number,
  offsetY: number,
  wrap: boolean,
): ImageData {
  const dst = applyTileOffsetPixels(src.data, src.width, src.height, offsetX, offsetY, wrap);
  // Construct ImageData from a plain ArrayBuffer copy to avoid SharedArrayBuffer TS issues.
  const plain = new Uint8ClampedArray(dst.buffer.slice(0) as ArrayBuffer);
  return new ImageData(plain, src.width, src.height);
}
