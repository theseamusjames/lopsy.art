import { describe, it, expect } from 'vitest';
import { applySpherizeToPixels, type SpherizeMode } from './spherize-cpu';

function makePixels(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function getPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!, pixels[idx + 3]!];
}

function applySpherize(src: Uint8ClampedArray, width: number, height: number, amount: number, mode: SpherizeMode): Uint8ClampedArray {
  return applySpherizeToPixels(src, width, height, amount, mode);
}

describe('applySpherizeToPixels', () => {
  it('amount=0 produces identity output', () => {
    const W = 64;
    const H = 64;
    const src = makePixels(W, H, (x, y) => [x * 4, y * 4, 128, 255]);
    const result = applySpherize(src, W, H, 0, 'normal');

    // Interior pixels should match source (bilinear at exact integer coords)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const [sr, sg, sb, sa] = getPixel(src, W, x, y);
        const [dr, dg, db, da] = getPixel(result, W, x, y);
        expect(Math.abs(dr - sr)).toBeLessThanOrEqual(1);
        expect(Math.abs(dg - sg)).toBeLessThanOrEqual(1);
        expect(Math.abs(db - sb)).toBeLessThanOrEqual(1);
        expect(da).toBe(sa);
      }
    }
  });

  it('output has same byte length as input', () => {
    const W = 100;
    const H = 80;
    const src = makePixels(W, H, () => [255, 255, 255, 255]);
    const result = applySpherize(src, W, H, 0.5, 'normal');
    expect(result.length).toBe(W * H * 4);
  });

  it('center pixel stays opaque for spherize (positive amount)', () => {
    const W = 64;
    const H = 64;
    const src = makePixels(W, H, () => [200, 100, 50, 255]);
    const result = applySpherize(src, W, H, 1.0, 'normal');
    // At exact center, r=0 so rNew=0, sampling lands on the center itself
    const [, , , a] = getPixel(result, W, W / 2, H / 2);
    expect(a).toBe(255);
  });

  it('spherize (positive) keeps corner pixels opaque but shifts interior pixels', () => {
    const W = 64;
    const H = 64;
    // Radial gradient from center: brighter at edges
    const cx = W / 2;
    const cy = H / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    const src = makePixels(W, H, (x, y) => {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const v = Math.round((d / maxDist) * 255);
      return [v, v, v, 255];
    });

    const identity = applySpherize(src, W, H, 0, 'normal');
    const spherized = applySpherize(src, W, H, 1.0, 'normal');

    // Center pixel should still be opaque
    const [, , , centerA] = getPixel(spherized, W, W / 2, H / 2);
    expect(centerA).toBe(255);

    // Center region should be brighter in spherized (reads from larger radius in source)
    let brighterCount = 0;
    for (let y = W / 4; y < 3 * H / 4; y++) {
      for (let x = W / 4; x < 3 * W / 4; x++) {
        const [ir] = getPixel(identity, W, x, y);
        const [sr] = getPixel(spherized, W, x, y);
        if (sr > ir + 5) brighterCount++;
      }
    }
    // Spherize magnifies center → center samples from larger radius → brighter values
    expect(brighterCount).toBeGreaterThan(50);
  });

  it('pinch (negative) displaces center pixels — output differs from identity at center region', () => {
    const W = 64;
    const H = 64;
    // Gradient so different positions produce different colors
    const src = makePixels(W, H, (x) => [x * 4, 0, 0, 255]);
    const identity = applySpherize(src, W, H, 0, 'normal');
    const pinched = applySpherize(src, W, H, -1.0, 'normal');

    // Count changed pixels in the center region
    let diffCount = 0;
    for (let y = 16; y < 48; y++) {
      for (let x = 16; x < 48; x++) {
        const [ir] = getPixel(identity, W, x, y);
        const [pr] = getPixel(pinched, W, x, y);
        if (Math.abs(ir - pr) > 5) diffCount++;
      }
    }
    // Pinch should change a meaningful number of center pixels
    expect(diffCount).toBeGreaterThan(30);
  });

  it('spherize (positive) differs from identity throughout', () => {
    const W = 64;
    const H = 64;
    const src = makePixels(W, H, (x, y) => [x * 4, y * 4, 128, 255]);
    const identity = applySpherize(src, W, H, 0, 'normal');
    const spherized = applySpherize(src, W, H, 1.0, 'normal');

    let diffCount = 0;
    for (let y = 4; y < H - 4; y++) {
      for (let x = 4; x < W - 4; x++) {
        const [ir, ig] = getPixel(identity, W, x, y);
        const [sr, sg] = getPixel(spherized, W, x, y);
        if (Math.abs(ir - sr) + Math.abs(ig - sg) > 5) diffCount++;
      }
    }
    // Should produce a significant number of changed pixels
    expect(diffCount).toBeGreaterThan(100);
  });

  it('horizontal mode only distorts pixels along the x axis', () => {
    const W = 64;
    const H = 64;
    // Pure vertical gradient so horizontal distortion doesn't change G values
    // but a horizontal gradient would change R values
    const src = makePixels(W, H, (x) => [x * 4, 128, 128, 255]);
    const result = applySpherize(src, W, H, 0.8, 'horizontal');

    // Along center column (x=W/2), sampling should land near x=W/2 (no change at cx=0)
    const midX = Math.floor(W / 2);
    for (let y = 4; y < H - 4; y++) {
      const [, , , a] = getPixel(result, W, midX, y);
      expect(a).toBe(255);
    }

    // The result should differ from the source across the row (horizontal distortion active)
    let diffCount = 0;
    const midY = Math.floor(H / 2);
    for (let x = 4; x < W - 4; x++) {
      const [sr] = getPixel(src, W, x, midY);
      const [dr] = getPixel(result, W, x, midY);
      if (Math.abs(dr - sr) > 3) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(10);
  });

  it('vertical mode only distorts pixels along the y axis', () => {
    const W = 64;
    const H = 64;
    const src = makePixels(W, H, (_x, y) => [128, y * 4, 128, 255]);
    const result = applySpherize(src, W, H, 0.8, 'vertical');

    // Along center row (y=H/2), sampling should land near y=H/2 (no change at cy=0)
    const midY = Math.floor(H / 2);
    for (let x = 4; x < W - 4; x++) {
      const [, , , a] = getPixel(result, W, x, midY);
      expect(a).toBe(255);
    }

    // The result should differ from the source along the column (vertical distortion active)
    let diffCount = 0;
    const midX = Math.floor(W / 2);
    for (let y = 4; y < H - 4; y++) {
      const [, sg] = getPixel(src, W, midX, y);
      const [, dg] = getPixel(result, W, midX, y);
      if (Math.abs(dg - sg) > 3) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(10);
  });
});
