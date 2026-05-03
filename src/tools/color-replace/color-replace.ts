import type { PixelSurface } from '../../types';

/**
 * Convert RGB (0–255) to HSL (h: 0–360, s: 0–1, l: 0–1).
 * Pure math — no DOM, no React.
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
    if (h < 0) h += 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h = h * 60;

  return { h, s, l };
}

/**
 * Convert HSL (h: 0–360, s: 0–1, l: 0–1) back to RGB (0–255).
 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Replace the hue and saturation of `pixel` with those of `foreground`,
 * keeping the pixel's original luminance.
 *
 * `opacity` (0–1) blends the result back onto the original.
 *
 * Returns RGB values (0–255). Alpha is unchanged.
 */
export function replaceColor(
  pixelR: number,
  pixelG: number,
  pixelB: number,
  fgR: number,
  fgG: number,
  fgB: number,
  opacity: number,
): { r: number; g: number; b: number } {
  const original = rgbToHsl(pixelR, pixelG, pixelB);
  const fg = rgbToHsl(fgR, fgG, fgB);

  // Replace H and S from foreground; keep L from original pixel.
  const replaced = hslToRgb(fg.h, fg.s, original.l);

  // Blend with opacity.
  return {
    r: Math.round(pixelR + (replaced.r - pixelR) * opacity),
    g: Math.round(pixelG + (replaced.g - pixelG) * opacity),
    b: Math.round(pixelB + (replaced.b - pixelB) * opacity),
  };
}

/**
 * Compute Euclidean colour distance in RGB space (0–255 scale).
 * Used for the tolerance check: only paint pixels close to the
 * sampled reference colour.
 */
export function colorDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Apply a single colour-replacement dab to `surface`.
 *
 * The dab is a soft circle centred at (`cx`, `cy`) with the given `size`
 * (diameter). For each pixel inside the radius:
 *  - If the tolerance check passes (the pixel is close enough to
 *    `sampledColor`), the H/S channels are replaced with those of
 *    `foreground` while the pixel's L is preserved.
 *  - The brush falloff modulates `opacity` — the centre replaces fully,
 *    the edge tapers to zero.
 *
 * `sampledColor` is the colour that was under the cursor at mousedown.
 * Pixels whose RGB distance to `sampledColor` exceeds `tolerance` are
 * untouched, which keeps the tool from bleeding into areas of a different
 * base colour.
 */
export function applyColorReplaceDab(
  surface: PixelSurface,
  cx: number,
  cy: number,
  size: number,
  foregroundR: number,
  foregroundG: number,
  foregroundB: number,
  sampledR: number,
  sampledG: number,
  sampledB: number,
  tolerance: number,
  opacity: number,
): void {
  const radius = Math.floor(size / 2);
  if (radius <= 0) return;

  const radiusSq = radius * radius;
  const cxi = Math.round(cx);
  const cyi = Math.round(cy);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;

      const px = cxi + dx;
      const py = cyi + dy;
      const pixel = surface.getPixel(px, py);
      if (pixel.a <= 0) continue;

      // Tolerance gate — skip pixels that differ too much from the
      // sampled colour so the tool stays within the colour region being
      // edited.
      const dist = colorDistance(pixel.r, pixel.g, pixel.b, sampledR, sampledG, sampledB);
      if (tolerance < 255 && dist > tolerance) continue;

      // Soft quadratic falloff matching the GPU brush dab convention.
      const d = Math.sqrt(distSq) / radius;
      let soft = 1 - d * d;
      soft = soft * soft;

      const effectiveOpacity = Math.min(1, Math.max(0, soft * opacity));
      if (effectiveOpacity <= 0) continue;

      const replaced = replaceColor(pixel.r, pixel.g, pixel.b, foregroundR, foregroundG, foregroundB, effectiveOpacity);
      surface.setPixel(px, py, { r: replaced.r, g: replaced.g, b: replaced.b, a: pixel.a });
    }
  }
}
