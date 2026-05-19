import { describe, expect, it } from 'vitest';
import { computeHistogram, EMPTY_HISTOGRAM, histogramPercentile } from './histogram-compute';

function makeImage(pixels: ReadonlyArray<readonly [number, number, number, number]>): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    data[i * 4] = p[0];
    data[i * 4 + 1] = p[1];
    data[i * 4 + 2] = p[2];
    data[i * 4 + 3] = p[3];
  });
  return new ImageData(data, pixels.length, 1);
}

describe('computeHistogram', () => {
  it('returns empty bins for an empty input list', () => {
    const h = computeHistogram([]);
    expect(h.total).toBe(0);
    expect(h.r.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('counts opaque pixels per channel', () => {
    const img = makeImage([
      [10, 20, 30, 255],
      [10, 20, 30, 255],
      [100, 100, 100, 255],
    ]);
    const h = computeHistogram([img]);
    expect(h.r[10]).toBe(2);
    expect(h.g[20]).toBe(2);
    expect(h.b[30]).toBe(2);
    expect(h.r[100]).toBe(1);
  });

  it('skips fully transparent pixels', () => {
    const img = makeImage([
      [10, 20, 30, 0],   // skipped
      [40, 50, 60, 7],   // skipped (alpha < 8)
      [70, 80, 90, 255], // counted
    ]);
    const h = computeHistogram([img]);
    expect(h.r[10]).toBe(0);
    expect(h.r[40]).toBe(0);
    expect(h.r[70]).toBe(1);
    expect(h.total).toBe(1);
  });

  it('merges multiple source images', () => {
    const a = makeImage([[10, 0, 0, 255]]);
    const b = makeImage([[10, 0, 0, 255], [200, 0, 0, 255]]);
    const h = computeHistogram([a, b]);
    expect(h.r[10]).toBe(2);
    expect(h.r[200]).toBe(1);
  });

  it('ignores null entries in the source list', () => {
    const img = makeImage([[10, 20, 30, 255]]);
    const h = computeHistogram([null, img, null]);
    expect(h.total).toBe(1);
  });
});

describe('histogramPercentile', () => {
  it('returns 0 when all bins are empty', () => {
    expect(histogramPercentile(EMPTY_HISTOGRAM.r, 0.99)).toBe(0);
  });

  it('returns a value below the max for non-uniform input', () => {
    const bins = new Uint32Array(256);
    for (let i = 0; i < 10; i++) bins[i] = 5;
    bins[200] = 10_000; // outlier spike
    const p = histogramPercentile(bins, 0.9);
    expect(p).toBeLessThan(10_000);
    expect(p).toBeGreaterThanOrEqual(5);
  });
});
