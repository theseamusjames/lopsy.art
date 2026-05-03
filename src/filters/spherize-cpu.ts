export type SpherizeMode = 'normal' | 'horizontal' | 'vertical';

/** Bilinear sample from src pixels at fractional (sx, sy). Returns [r,g,b,a]. */
function bilinearSample(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
): [number, number, number, number] {
  if (sx < 0 || sx > width - 1 || sy < 0 || sy > height - 1) {
    return [0, 0, 0, 0];
  }
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = sx - x0;
  const fy = sy - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const r = Math.round(
    pixels[idx00]! * (1 - fx) * (1 - fy) +
    pixels[idx10]! * fx * (1 - fy) +
    pixels[idx01]! * (1 - fx) * fy +
    pixels[idx11]! * fx * fy,
  );
  const g = Math.round(
    pixels[idx00 + 1]! * (1 - fx) * (1 - fy) +
    pixels[idx10 + 1]! * fx * (1 - fy) +
    pixels[idx01 + 1]! * (1 - fx) * fy +
    pixels[idx11 + 1]! * fx * fy,
  );
  const b = Math.round(
    pixels[idx00 + 2]! * (1 - fx) * (1 - fy) +
    pixels[idx10 + 2]! * fx * (1 - fy) +
    pixels[idx01 + 2]! * (1 - fx) * fy +
    pixels[idx11 + 2]! * fx * fy,
  );
  const a = Math.round(
    pixels[idx00 + 3]! * (1 - fx) * (1 - fy) +
    pixels[idx10 + 3]! * fx * (1 - fy) +
    pixels[idx01 + 3]! * (1 - fx) * fy +
    pixels[idx11 + 3]! * fx * fy,
  );
  return [r, g, b, a];
}

/**
 * CPU implementation of spherize/pinch distortion with bilinear sampling.
 *
 * Positive amount = spherize (barrel distortion, center bulges outward).
 * Negative amount = pinch (center pulls inward).
 * Amount range: -1.0 to +1.0.
 *
 * Operates on raw RGBA pixel buffers (no DOM types) so it can be unit-tested in Node.
 */
export function applySpherizeToPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  mode: SpherizeMode,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map pixel to centered normalized [-1, 1]
      const cx = (x / (width - 1)) * 2 - 1;
      const cy = (y / (height - 1)) * 2 - 1;

      let distX = cx;
      let distY = cy;

      if (mode === 'horizontal') {
        const maxR = 1.0;
        const r = Math.abs(cx);
        const rNew = r + amount * r * (1 - r / maxR);
        distX = Math.sign(cx) * rNew;
      } else if (mode === 'vertical') {
        const maxR = 1.0;
        const r = Math.abs(cy);
        const rNew = r + amount * r * (1 - r / maxR);
        distY = Math.sign(cy) * rNew;
      } else {
        // Normal: radial distortion
        const maxR = Math.SQRT2;
        const r = Math.sqrt(cx * cx + cy * cy);
        if (r > 0) {
          const rNew = r + amount * r * (1 - r / maxR);
          distX = (cx / r) * rNew;
          distY = (cy / r) * rNew;
        }
      }

      // Map back to pixel coordinates
      const srcX = ((distX + 1) / 2) * (width - 1);
      const srcY = ((distY + 1) / 2) * (height - 1);

      const [r, g, b, a] = bilinearSample(src, width, height, srcX, srcY);
      const dstIdx = (y * width + x) * 4;
      out[dstIdx] = r;
      out[dstIdx + 1] = g;
      out[dstIdx + 2] = b;
      out[dstIdx + 3] = a;
    }
  }

  return out;
}
