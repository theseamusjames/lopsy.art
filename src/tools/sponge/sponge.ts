import type { Point, PixelSurface } from '../../types';

export type SpongeMode = 'saturate' | 'desaturate';

/** Convert 0–255 RGB to HSL. Returns H in [0,360), S and L in [0,1]. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  return [h * 60, s, l];
}

/** Convert HSL (H in [0,360), S and L in [0,1]) to 0–255 RGB. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  function hue2rgb(t: number): number {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }

  return [
    Math.round(hue2rgb(hNorm + 1 / 3) * 255),
    Math.round(hue2rgb(hNorm) * 255),
    Math.round(hue2rgb(hNorm - 1 / 3) * 255),
  ];
}

/**
 * Apply one sponge dab at `pos`.
 * For each pixel within the circular radius, convert RGB→HSL, adjust S by
 * ±(strength * falloff), then convert back to RGB.
 */
export function applySponge(
  buf: PixelSurface,
  pos: Point,
  size: number,
  mode: SpongeMode,
  strength: number,
): void {
  const radius = Math.floor(size / 2);
  const cx = Math.round(pos.x);
  const cy = Math.round(pos.y);
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      const pixel = buf.getPixel(px, py);
      if (pixel.a <= 0) continue;

      // Gaussian-like falloff: 1 at center, 0 at edge
      const falloff = radius > 0 ? 1 - Math.sqrt(dist2) / radius : 1;
      const delta = strength * falloff;

      const [h, s, l] = rgbToHsl(pixel.r, pixel.g, pixel.b);
      const newS = mode === 'saturate'
        ? Math.min(1, s + delta)
        : Math.max(0, s - delta);
      const [nr, ng, nb] = hslToRgb(h, newS, l);

      buf.setPixel(px, py, { r: nr, g: ng, b: nb, a: pixel.a });
    }
  }
}
