/**
 * Gamut check utilities for soft proofing.
 *
 * Lopsy uses Display P3 (wide gamut) for rendering when supported. Pixels
 * whose linearised P3 values exceed the sRGB gamut boundary are out-of-gamut
 * for sRGB targets (web, most printers). We detect these in the 8-bit
 * composited output by checking whether any channel exceeds 235 (≈ 0.922),
 * which corresponds to the peak sRGB primary within the P3 gamut.
 *
 * For CMYK simulation, we approximate CMYK's reduced colour volume by
 * desaturating the image and reducing vibrant hues.
 */

/** Number of channels per pixel (RGBA). */
const CHANNELS = 4;

/**
 * Whether a pixel (given as r, g, b in 0–255) is outside the sRGB gamut when
 * the display is operating in Display P3.
 *
 * In 8-bit P3-encoded pixels, values above ~235 for any channel indicate a
 * colour that cannot be reproduced in sRGB without clamping.  The exact
 * threshold is derived from the P3-to-sRGB matrix: the most saturated P3
 * primaries map to sRGB values near 1.09 (≈ 234/255 scaled down to fit), so
 * any channel above 235 in the P3 image data is out-of-gamut for sRGB export.
 *
 * When the session is NOT wide-gamut (sRGB only), this function always returns
 * false — every pixel is already sRGB.
 */
export function isOutOfSrgbGamut(r: number, g: number, b: number, isWideGamut: boolean): boolean {
  if (!isWideGamut) return false;
  // Threshold: ~235/255 ≈ 0.922 represents the sRGB white point in P3 encoding.
  // Any channel that exceeds this cannot be represented in sRGB without clipping.
  return r > 235 || g > 235 || b > 235;
}

/**
 * Apply the sRGB-clamp soft-proof transformation to a single pixel in place.
 * Clamps all channels to 235 (the sRGB boundary in P3-encoded 8-bit space).
 * No-op when not in wide-gamut mode.
 */
export function clampToSrgb(r: number, g: number, b: number, isWideGamut: boolean): [number, number, number] {
  if (!isWideGamut) return [r, g, b];
  const clamp = (v: number) => Math.min(v, 235);
  return [clamp(r), clamp(g), clamp(b)];
}

/**
 * Apply a basic CMYK simulation to a pixel (r, g, b in 0–255).
 *
 * CMYK printing cannot reproduce highly saturated blues or greens, and has a
 * smaller overall colour volume than sRGB. This simulation:
 *   - Reduces overall saturation by ~15 %
 *   - Pulls cyan-heavy (blue/green) channels down an additional 8 %
 *
 * The result gives a rough visual approximation of CMYK output on screen.
 */
export function simulateCmyk(r: number, g: number, b: number): [number, number, number] {
  // Desaturate ~15 % toward the luminance
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = 0.85;
  let rOut = lum + (r - lum) * sat;
  let gOut = lum + (g - lum) * sat;
  let bOut = lum + (b - lum) * sat;

  // Blues and greens are particularly reduced in CMYK — simulate by pulling
  // back the cyan-dominated channels a further 8 %
  const cyanDominance = Math.max(0, (gOut + bOut) / 2 - rOut) / 255;
  const reduction = 1 - cyanDominance * 0.08;
  gOut *= reduction;
  bOut *= reduction;

  return [
    Math.round(Math.min(255, Math.max(0, rOut))),
    Math.round(Math.min(255, Math.max(0, gOut))),
    Math.round(Math.min(255, Math.max(0, bOut))),
  ];
}

/**
 * Scan a full composited pixel buffer (bottom-up, RGBA 8-bit) and count
 * out-of-gamut pixels. Returns the count.
 */
export function countOutOfGamutPixels(pixels: ArrayLike<number>, isWideGamut: boolean): number {
  let count = 0;
  const total = pixels.length;
  for (let i = 0; i < total; i += CHANNELS) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if (isOutOfSrgbGamut(r, g, b, isWideGamut)) count++;
  }
  return count;
}

/**
 * Build a gamut warning overlay: for every out-of-gamut pixel in `pixels`,
 * write a bright magenta pixel into `out` (same dimensions, same layout).
 * Non-out-of-gamut pixels are left transparent (alpha = 0).
 *
 * `pixels` is a bottom-up RGBA buffer as returned by `__readCompositedPixels`.
 * `out` must be a pre-allocated Uint8ClampedArray of the same byte length.
 */
export function buildGamutWarningBuffer(
  pixels: ArrayLike<number>,
  out: Uint8ClampedArray,
  isWideGamut: boolean,
): void {
  const total = pixels.length;
  for (let i = 0; i < total; i += CHANNELS) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if (isOutOfSrgbGamut(r, g, b, isWideGamut)) {
      out[i] = 255;       // R — magenta
      out[i + 1] = 0;     // G
      out[i + 2] = 255;   // B — magenta
      out[i + 3] = 200;   // alpha ~78 %
    } else {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }
}
