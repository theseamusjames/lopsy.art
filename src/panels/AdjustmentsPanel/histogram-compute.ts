/**
 * Per-channel histogram of one or more ImageData sources.
 *
 * Pixels with alpha < 8 are treated as fully transparent and skipped
 * (otherwise empty regions of partially-painted layers would swamp the
 * R/G/B=0 bin).
 *
 * For performance, large sources are sampled with a stride so the cost
 * stays below ~1ms per source even for multi-megapixel layers.
 */

export interface Histogram {
  readonly r: Uint32Array;
  readonly g: Uint32Array;
  readonly b: Uint32Array;
  readonly total: number;
}

export const EMPTY_HISTOGRAM: Histogram = {
  r: new Uint32Array(256),
  g: new Uint32Array(256),
  b: new Uint32Array(256),
  total: 0,
};

const SAMPLE_TARGET = 50_000;

export function computeHistogram(images: readonly (ImageData | null)[]): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  let total = 0;

  for (const img of images) {
    if (!img) continue;
    const data = img.data;
    const pxCount = (data.length / 4) | 0;
    if (pxCount === 0) continue;
    const stride = Math.max(1, Math.floor(pxCount / SAMPLE_TARGET));
    for (let p = 0; p < pxCount; p += stride) {
      const i = p * 4;
      if (data[i + 3]! < 8) continue;
      r[data[i]!]!++;
      g[data[i + 1]!]!++;
      b[data[i + 2]!]!++;
      total++;
    }
  }

  return { r, g, b, total };
}

/**
 * Returns the value at the Nth percentile (0..1) of a 256-bin
 * histogram. Used to choose a vertical scale that ignores extreme
 * spikes (e.g. a giant alpha=255 column from a flat fill).
 */
export function histogramPercentile(bins: Uint32Array, percentile: number): number {
  let max = 0;
  for (let i = 0; i < 256; i++) if (bins[i]! > max) max = bins[i]!;
  if (max === 0) return 0;

  const counts: number[] = [];
  for (let i = 0; i < 256; i++) if (bins[i]! > 0) counts.push(bins[i]!);
  counts.sort((a, b) => a - b);
  const idx = Math.min(counts.length - 1, Math.floor(counts.length * percentile));
  return counts[idx] ?? max;
}
