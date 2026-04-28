import type { Color } from '../types';

/**
 * Build a selection mask by matching all pixels in `pixelData` against
 * `target` within the given `fuzziness` tolerance.
 *
 * Uses the same squared-Euclidean RGBA distance metric as the magic wand.
 * Returns a Uint8ClampedArray mask (255 = selected, 0 = not).
 */
export function colorRangeSelect(
  pixelData: Uint8Array,
  width: number,
  height: number,
  target: Color,
  fuzziness: number,
): Uint8ClampedArray {
  const total = width * height;
  const mask = new Uint8ClampedArray(total);
  const tolSq = fuzziness * fuzziness;
  const tr = target.r;
  const tg = target.g;
  const tb = target.b;
  const ta = Math.round(target.a * 255);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const dr = (pixelData[idx] ?? 0) - tr;
    const dg = (pixelData[idx + 1] ?? 0) - tg;
    const db = (pixelData[idx + 2] ?? 0) - tb;
    const da = (pixelData[idx + 3] ?? 0) - ta;
    if (dr * dr + dg * dg + db * db + da * da <= tolSq) {
      mask[i] = 255;
    }
  }

  return mask;
}
