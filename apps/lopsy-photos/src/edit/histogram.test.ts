import { describe, expect, it } from 'vitest';
import { BINS, clipping, formatShare, histogramPath, innerMax, isClipped, parseHistogram, sharedMax } from './histogram';

function bins(fill: (channel: number, bin: number) => number): Uint32Array {
  const out = new Uint32Array(BINS * 4);
  for (let c = 0; c < 4; c++) for (let i = 0; i < BINS; i++) out[c * BINS + i] = fill(c, i);
  return out;
}

describe('parseHistogram', () => {
  it('splits the four channels', () => {
    const h = parseHistogram(bins((c, i) => (i === 10 ? c + 1 : 0)));
    expect(h?.red[10]).toBe(1);
    expect(h?.luminance[10]).toBe(4);
    expect(h?.total).toBe(4);
  });

  it('rejects the wrong length and an empty image', () => {
    expect(parseHistogram(new Uint32Array(10))).toBeNull();
    expect(parseHistogram(bins(() => 0))).toBeNull();
  });
});

describe('histogramPath', () => {
  it('closes an area along the bottom of the box', () => {
    const path = histogramPath([0, 4, 16, 0], 30, 10);
    expect(path.startsWith('M0,10')).toBe(true);
    expect(path.endsWith('L30,10Z')).toBe(true);
    // sqrt scale: 16 is full height, 4 is half.
    expect(path).toContain('L10,5');
    expect(path).toContain('L20,0');
  });

  it('caps end spikes at the top of the box', () => {
    const path = histogramPath([1000, 1, 4, 1000], 30, 10);
    expect(path).toContain('L0,0');
    expect(path).toContain('L20,0');
  });

  it('draws a flat line for no counts', () => {
    expect(histogramPath([0, 0, 0], 20, 8)).toBe('M0,8L0,8L10,8L20,8L20,8Z');
  });
});

describe('scales', () => {
  it('ignores the end bins unless they are all there is', () => {
    expect(innerMax([100, 3, 5, 100])).toBe(5);
    expect(innerMax([100, 0, 0, 7])).toBe(100);
  });

  it('shares one scale across channels', () => {
    const h = parseHistogram(bins((c, i) => (i === 5 ? (c + 1) * 10 : 1)));
    expect(h && sharedMax(h)).toBe(40);
  });
});

describe('clipping', () => {
  it('reports the worst channel at each end', () => {
    const h = parseHistogram(bins((c, i) => (i === 0 && c === 2 ? 50 : i === BINS - 1 && c === 0 ? 5 : i === 100 ? 950 : 0)));
    if (!h) throw new Error('no histogram');
    const clip = clipping(h);
    expect(clip.shadows).toBeCloseTo(50 / 950);
    expect(clip.highlights).toBeCloseTo(5 / 950);
    expect(isClipped(clip.shadows)).toBe(true);
    expect(isClipped(0.001)).toBe(false);
    expect(formatShare(0.0042)).toBe('0.4 %');
  });
});
