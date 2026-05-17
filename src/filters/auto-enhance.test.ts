import { describe, it, expect } from 'vitest';
import {
  computeHistograms,
  computeAutoTone,
  computeAutoContrast,
  computeAutoColor,
} from './auto-enhance';

function makePixelData(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4] = pixels[i]![0];
    data[i * 4 + 1] = pixels[i]![1];
    data[i * 4 + 2] = pixels[i]![2];
    data[i * 4 + 3] = pixels[i]![3];
  }
  return data;
}

describe('computeHistograms', () => {
  it('counts opaque pixels correctly', () => {
    const data = makePixelData([
      [100, 150, 200, 255],
      [100, 150, 200, 255],
      [50, 75, 100, 255],
    ]);
    const hist = computeHistograms(data);
    expect(hist.r.counts[100]).toBe(2);
    expect(hist.r.counts[50]).toBe(1);
    expect(hist.g.counts[150]).toBe(2);
    expect(hist.b.counts[200]).toBe(2);
    expect(hist.r.totalPixels).toBe(3);
  });

  it('skips transparent pixels', () => {
    const data = makePixelData([
      [100, 150, 200, 255],
      [50, 75, 100, 0],
    ]);
    const hist = computeHistograms(data);
    expect(hist.r.totalPixels).toBe(1);
    expect(hist.r.counts[50]).toBe(0);
  });
});

describe('computeAutoTone', () => {
  it('stretches narrow range to full', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 1000; i++) {
      const v = 50 + Math.floor((i / 999) * 100);
      pixels.push([v, v, v, 255]);
    }
    const data = makePixelData(pixels);
    const levels = computeAutoTone(data);

    expect(levels.r.inputBlack).toBeGreaterThan(0);
    expect(levels.r.inputWhite).toBeLessThan(1);
    expect(levels.r.inputBlack).toBeCloseTo(levels.g.inputBlack, 2);
  });

  it('returns identity for already-full-range image', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 256; i++) {
      for (let j = 0; j < 10; j++) {
        pixels.push([i, i, i, 255]);
      }
    }
    const data = makePixelData(pixels);
    const levels = computeAutoTone(data);

    expect(levels.r.inputBlack).toBeLessThanOrEqual(3 / 255);
    expect(levels.r.inputWhite).toBeGreaterThanOrEqual(252 / 255);
  });
});

describe('computeAutoContrast', () => {
  it('adjusts master channel only, leaves per-channel at identity', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 1000; i++) {
      const v = 50 + Math.floor((i / 999) * 100);
      pixels.push([v + 20, v, v - 20, 255]);
    }
    const data = makePixelData(pixels);
    const levels = computeAutoContrast(data);

    expect(levels.rgb.inputBlack).toBeGreaterThan(0);
    expect(levels.r.inputBlack).toBe(0);
    expect(levels.r.inputWhite).toBe(1);
    expect(levels.g.inputBlack).toBe(0);
    expect(levels.b.inputBlack).toBe(0);
  });
});

describe('computeAutoColor', () => {
  it('produces near-identity curves for balanced image', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 1000; i++) {
      const v = Math.floor((i / 999) * 255);
      pixels.push([v, v, v, 255]);
    }
    const data = makePixelData(pixels);
    const curves = computeAutoColor(data);

    expect(curves.r.length).toBeLessThanOrEqual(3);
    expect(curves.g.length).toBeLessThanOrEqual(3);
    expect(curves.b.length).toBeLessThanOrEqual(3);
  });

  it('shifts channel means toward neutral for color-cast image', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 1000; i++) {
      pixels.push([200, 100, 100, 255]);
    }
    const data = makePixelData(pixels);
    const curves = computeAutoColor(data);

    const rMid = curves.r.find((p) => p.x > 0 && p.x < 1);
    const gMid = curves.g.find((p) => p.x > 0 && p.x < 1);

    if (rMid) {
      expect(rMid.y).toBeLessThan(rMid.x);
    }
    if (gMid) {
      expect(gMid.y).toBeGreaterThan(gMid.x);
    }
  });
});
