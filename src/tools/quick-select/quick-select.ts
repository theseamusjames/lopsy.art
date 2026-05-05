/**
 * Quick Selection tool — paint-to-select with edge-aware flood fill.
 *
 * Algorithm per stroke point:
 *   1. Sample the seed color from the image at the brush center.
 *   2. Flood fill outward from the brush center:
 *      a. For each candidate pixel, check color distance to seed.
 *      b. Check Sobel gradient magnitude at that pixel.
 *      c. If color is similar AND gradient is below the edge threshold, select it and continue expanding.
 *      d. Stop expanding at edges or when color diverges.
 *   3. The selection mask is merged (add/subtract) into the existing mask.
 *
 * All logic is pure — no DOM, no React, no rendering.
 */

export interface QuickSelectParams {
  /** Image RGBA pixel data (length = width * height * 4). */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Brush radius in pixels — controls seed sampling area and max flood distance. */
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

function colorDistanceSq(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function sobelMagnitude(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const sample = (cx: number, cy: number): [number, number, number] => {
    const sx = Math.max(0, Math.min(width - 1, cx));
    const sy = Math.max(0, Math.min(height - 1, cy));
    const idx = (sy * width + sx) * 4;
    return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!];
  };

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
  const r = Math.max(1, Math.round(radius / 3));
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
 * Flood fill outward from (cx, cy), selecting connected pixels that
 * match the seed color and don't cross strong edges.
 */
function floodFillSelect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  visited: Uint8Array,
  mask: Uint8ClampedArray,
  cx: number,
  cy: number,
  seed: { r: number; g: number; b: number },
  toleranceSq: number,
  edgeThreshold: number,
  mode: 'add' | 'subtract',
): void {
  const startX = Math.round(cx);
  const startY = Math.round(cy);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const stack: number[] = [startX, startY];
  const fillVal = mode === 'add' ? 255 : 0;

  while (stack.length > 0) {
    const py = stack.pop()!;
    const px = stack.pop()!;

    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const idx = py * width + px;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const pIdx = idx * 4;
    const pr = pixels[pIdx]!;
    const pg = pixels[pIdx + 1]!;
    const pb = pixels[pIdx + 2]!;

    const dist = colorDistanceSq(pr, pg, pb, seed.r, seed.g, seed.b);
    if (dist > toleranceSq) continue;

    const gradient = sobelMagnitude(pixels, width, height, px, py);
    if (gradient > edgeThreshold) continue;

    mask[idx] = fillVal;

    stack.push(px - 1, py);
    stack.push(px + 1, py);
    stack.push(px, py - 1);
    stack.push(px, py + 1);
  }
}

/**
 * Apply a quick-selection stroke to produce an updated selection mask.
 */
export function applyQuickSelectStroke(
  params: QuickSelectParams,
  stroke: QuickSelectStrokeInput,
): Uint8ClampedArray {
  const { pixels, width, height, radius, tolerance, edgeStrength } = params;
  const { points, existingMask, mode } = stroke;

  const mask = existingMask
    ? new Uint8ClampedArray(existingMask)
    : new Uint8ClampedArray(width * height);

  if (points.length === 0) return mask;

  const edgeThreshold = edgeStrength === 0
    ? Infinity
    : (1 - edgeStrength / 100) * 360 + 5;

  const toleranceSq = tolerance * tolerance * 3;

  const visited = new Uint8Array(width * height);

  for (const pt of points) {
    const seed = sampleSeedColor(pixels, width, height, pt.x, pt.y, radius);
    floodFillSelect(
      pixels, width, height, visited, mask,
      pt.x, pt.y,
      seed, toleranceSq, edgeThreshold,
      mode,
    );
  }

  return mask;
}
