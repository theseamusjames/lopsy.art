import { describe, it, expect } from 'vitest';
import { rgbToHsl, hslToRgb, applySponge } from './sponge';
import { PixelBuffer } from '../../engine/pixel-data';

// ---------------------------------------------------------------------------
// RGB ↔ HSL roundtrip
// ---------------------------------------------------------------------------

describe('rgbToHsl', () => {
  it('pure red', () => {
    const [h, s, l] = rgbToHsl(255, 0, 0);
    expect(h).toBeCloseTo(0);
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
  });

  it('pure green', () => {
    const [h, s, l] = rgbToHsl(0, 255, 0);
    expect(h).toBeCloseTo(120);
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
  });

  it('pure blue', () => {
    const [h, s, l] = rgbToHsl(0, 0, 255);
    expect(h).toBeCloseTo(240);
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
  });

  it('gray (no saturation)', () => {
    const [h, s, l] = rgbToHsl(128, 128, 128);
    expect(s).toBeCloseTo(0);
    expect(l).toBeCloseTo(128 / 255, 2);
    // H is undefined for gray; we just care that s === 0
    expect(h).toBe(0);
  });

  it('white', () => {
    const [, s, l] = rgbToHsl(255, 255, 255);
    expect(s).toBeCloseTo(0);
    expect(l).toBeCloseTo(1);
  });

  it('black', () => {
    const [, s, l] = rgbToHsl(0, 0, 0);
    expect(s).toBeCloseTo(0);
    expect(l).toBeCloseTo(0);
  });
});

describe('hslToRgb', () => {
  it('pure red', () => {
    const [r, g, b] = hslToRgb(0, 1, 0.5);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('gray (no saturation)', () => {
    const [r, g, b] = hslToRgb(0, 0, 0.5);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('RGB ↔ HSL roundtrip', () => {
  const samples = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 200, g: 100, b: 50 },
    { r: 10, g: 200, b: 180 },
    { r: 128, g: 128, b: 128 },
  ];
  for (const { r, g, b } of samples) {
    it(`roundtrip (${r},${g},${b})`, () => {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [rr, gg, bb] = hslToRgb(h, s, l);
      expect(rr).toBeCloseTo(r, -1);
      expect(gg).toBeCloseTo(g, -1);
      expect(bb).toBeCloseTo(b, -1);
    });
  }
});

// ---------------------------------------------------------------------------
// applySponge
// ---------------------------------------------------------------------------

function makeBuffer(width: number, height: number, fill: { r: number; g: number; b: number; a: number }) {
  const buf = new PixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf.setPixel(x, y, fill);
    }
  }
  return buf;
}

describe('applySponge', () => {
  it('saturate increases saturation on a colored pixel', () => {
    // Low-saturation orange-ish pixel
    const buf = makeBuffer(10, 10, { r: 180, g: 160, b: 140, a: 1 });
    const [, sBefore] = rgbToHsl(180, 160, 140);
    applySponge(buf, { x: 5, y: 5 }, 4, 'saturate', 0.5);
    const center = buf.getPixel(5, 5);
    const [, sAfter] = rgbToHsl(center.r, center.g, center.b);
    expect(sAfter).toBeGreaterThan(sBefore);
  });

  it('desaturate decreases saturation on a colored pixel', () => {
    // Fully saturated red
    const buf = makeBuffer(10, 10, { r: 255, g: 0, b: 0, a: 1 });
    const [, sBefore] = rgbToHsl(255, 0, 0);
    applySponge(buf, { x: 5, y: 5 }, 4, 'desaturate', 0.5);
    const center = buf.getPixel(5, 5);
    const [, sAfter] = rgbToHsl(center.r, center.g, center.b);
    expect(sAfter).toBeLessThan(sBefore);
  });

  it('desaturate on pure gray is a no-op (already 0 saturation)', () => {
    const buf = makeBuffer(10, 10, { r: 128, g: 128, b: 128, a: 1 });
    applySponge(buf, { x: 5, y: 5 }, 4, 'desaturate', 0.5);
    const center = buf.getPixel(5, 5);
    // Saturation was already 0, should stay 0
    const [, sAfter] = rgbToHsl(center.r, center.g, center.b);
    expect(sAfter).toBeCloseTo(0);
  });

  it('saturate clamps saturation at 1.0', () => {
    // Already fully saturated
    const buf = makeBuffer(10, 10, { r: 255, g: 0, b: 0, a: 1 });
    applySponge(buf, { x: 5, y: 5 }, 4, 'saturate', 1.0);
    const center = buf.getPixel(5, 5);
    const [, sAfter] = rgbToHsl(center.r, center.g, center.b);
    expect(sAfter).toBeLessThanOrEqual(1);
  });

  it('does not affect transparent pixels', () => {
    const buf = makeBuffer(10, 10, { r: 200, g: 50, b: 50, a: 0 });
    applySponge(buf, { x: 5, y: 5 }, 4, 'desaturate', 1.0);
    const center = buf.getPixel(5, 5);
    expect(center.a).toBe(0);
  });

  it('only affects pixels within circular radius', () => {
    const buf = makeBuffer(20, 20, { r: 255, g: 0, b: 0, a: 1 });
    applySponge(buf, { x: 10, y: 10 }, 4, 'desaturate', 0.5);
    // Pixel far from center should be unchanged
    const corner = buf.getPixel(0, 0);
    expect(corner.r).toBe(255);
    expect(corner.g).toBe(0);
    expect(corner.b).toBe(0);
  });

  it('preserves alpha value', () => {
    const buf = makeBuffer(10, 10, { r: 255, g: 0, b: 0, a: 0.5 });
    applySponge(buf, { x: 5, y: 5 }, 4, 'desaturate', 0.5);
    const center = buf.getPixel(5, 5);
    expect(center.a).toBeCloseTo(0.5, 1);
  });
});
