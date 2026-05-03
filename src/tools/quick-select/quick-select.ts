/**
 * Quick Selection tool — paint-to-select with edge-aware expansion.
 *
 * Algorithm per stroke segment:
 *   1. Sample the seed color from the image at the brush center.
 *   2. For every pixel within the brush radius of any point on the stroke:
 *      a. Compute the color distance from the pixel to the seed color.
 *      b. Compute the gradient magnitude at that pixel (Sobel).
 *      c. If color distance <= tolerance AND gradient < edgeThreshold, mark selected.
 *   3. The selection mask is merged (add/subtract) into the existing mask.
 *
 * All logic is pure — no DOM, no React, no rendering.
 */

export interface QuickSelectParams {
  /** Image RGBA pixel data (length = width * height * 4). */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Brush radius in pixels (1–100). */
  radius: number;
  /** Color distance threshold (0–255). Higher = select more. */
  tolerance: number;
  /** Edge strength (0–100). Higher = harder edge stop. */
  edgeStrength: number;
}

export interface QuickSelectStrokeInput {
  /** Canvas-space points along the stroke. */
  points: ReadonlyArray<{ x: number; y: number }>;
  /** Existing selection mask; will be merged with the new stroke. */
  existingMask: Uint8ClampedArray | null;
  /** 'add' grows the selection, 'subtract' removes from it. */
  mode: 'add' | 'subtract';
}

/**
 * Compute the squared Euclidean color distance between two RGBA pixels.
 * Alpha is ignored — we match on visible color only.
 */
function colorDistanceSq(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Compute the Sobel gradient magnitude at pixel (x, y).
 * Returns a value in [0, ~1443] (sqrt(3) * 255^2 capped).
 */
function sobelMagnitude(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  // Clamp-to-border sampling
  const sample = (cx: number, cy: number): [number, number, number] => {
    const sx = Math.max(0, Math.min(width - 1, cx));
    const sy = Math.max(0, Math.min(height - 1, cy));
    const idx = (sy * width + sx) * 4;
    return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!];
  };

  // 3×3 Sobel kernel on luminance
  const lum = (r: number, g: number, b: number) =>
    0.299 * r + 0.587 * g + 0.114 * b;

  const tl = lum(...sample(x - 1, y - 1));
  const tm = lum(...sample(x,     y - 1));
  const tr = lum(...sample(x + 1, y - 1));
  const ml = lum(...sample(x - 1, y    ));
  const mr = lum(...sample(x + 1, y    ));
  const bl = lum(...sample(x - 1, y + 1));
  const bm = lum(...sample(x,     y + 1));
  const br = lum(...sample(x + 1, y + 1));

  const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
  const gy = -tl - 2 * tm - tr + bl + 2 * bm + br;
  return Math.sqrt(gx * gx + gy * gy);
}

/**
 * Sample the average RGBA color within the brush footprint of a point,
 * clamped to image bounds. Falls back to the single center pixel when the
 * radius is 0.
 */
function sampleSeedColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): { r: number; g: number; b: number } {
  const px = Math.round(cx);
  const py = Math.round(cy);
  const r = Math.max(1, Math.round(radius / 3)); // sample from inner 1/3 of brush
  let sumR = 0, sumG = 0, sumB = 0, count = 0;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const sx = px + dx;
      const sy = py + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const idx = (sy * width + sx) * 4;
      sumR += pixels[idx]!;
      sumG += pixels[idx + 1]!;
      sumB += pixels[idx + 2]!;
      count++;
    }
  }

  if (count === 0) {
    const cx2 = Math.max(0, Math.min(width - 1, px));
    const cy2 = Math.max(0, Math.min(height - 1, py));
    const idx = (cy2 * width + cx2) * 4;
    return { r: pixels[idx]!, g: pixels[idx + 1]!, b: pixels[idx + 2]! };
  }

  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
}

/**
 * Paint one brush footprint into the selection mask.
 *
 * For each pixel within `radius` of center (cx, cy):
 * - If its color distance to `seed` is within `tolerance` AND
 *   its Sobel gradient is below `edgeThreshold`, include it.
 */
function paintBrushFootprint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8ClampedArray,
  cx: number,
  cy: number,
  radius: number,
  seed: { r: number; g: number; b: number },
  toleranceSq: number,
  edgeThreshold: number,
  mode: 'add' | 'subtract',
): void {
  const px = Math.round(cx);
  const py = Math.round(cy);
  const irad = Math.ceil(radius);

  for (let dy = -irad; dy <= irad; dy++) {
    for (let dx = -irad; dx <= irad; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const sx = px + dx;
      const sy = py + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

      const idx = (sy * width + sx) * 4;
      const pr = pixels[idx]!;
      const pg = pixels[idx + 1]!;
      const pb = pixels[idx + 2]!;

      const dist = colorDistanceSq(pr, pg, pb, seed.r, seed.g, seed.b);
      if (dist > toleranceSq) continue;

      const gradient = sobelMagnitude(pixels, width, height, sx, sy);
      if (gradient > edgeThreshold) continue;

      const maskIdx = sy * width + sx;
      if (mode === 'add') {
        mask[maskIdx] = 255;
      } else {
        mask[maskIdx] = 0;
      }
    }
  }
}

/**
 * Apply a quick-selection stroke to produce an updated selection mask.
 *
 * @returns A new `Uint8ClampedArray` selection mask of size `width * height`.
 */
export function applyQuickSelectStroke(
  params: QuickSelectParams,
  stroke: QuickSelectStrokeInput,
): Uint8ClampedArray {
  const { pixels, width, height, radius, tolerance, edgeStrength } = params;
  const { points, existingMask, mode } = stroke;

  // Copy or create the mask to mutate
  const mask = existingMask
    ? new Uint8ClampedArray(existingMask)
    : new Uint8ClampedArray(width * height);

  if (points.length === 0) return mask;

  // Convert edge strength (0-100) to a Sobel threshold.
  // edgeStrength=0 means ignore edges (very high threshold),
  // edgeStrength=100 means stop at even faint edges.
  // Sobel magnitude on 8-bit luminance has a max of ~360 (=sqrt(2)*255).
  const edgeThreshold = edgeStrength === 0
    ? Infinity
    : (1 - edgeStrength / 100) * 360 + 5;

  // tolerance is a per-channel value; convert to squared distance in 3D RGB space
  const toleranceSq = tolerance * tolerance * 3;

  // Sample seed color from the first stroke point
  const seed = sampleSeedColor(pixels, width, height, points[0]!.x, points[0]!.y, radius);

  for (const pt of points) {
    paintBrushFootprint(
      pixels, width, height, mask,
      pt.x, pt.y,
      radius, seed, toleranceSq, edgeThreshold,
      mode,
    );
  }

  return mask;
}
