import { describe, it, expect } from 'vitest';
import {
  createDisplacementMap,
  applyPushDab,
  applyTwirlDab,
  sampleBilinear,
  applyDab,
  type LiquifySettings,
} from './liquify';

describe('createDisplacementMap', () => {
  it('initialises to all zeros', () => {
    const map = createDisplacementMap(10, 10);
    expect(map.dx.every((v) => v === 0)).toBe(true);
    expect(map.dy.every((v) => v === 0)).toBe(true);
  });
});

describe('applyPushDab', () => {
  it('adds drag vector at brush center', () => {
    const map = createDisplacementMap(100, 100);
    // Push to the right with full pressure
    applyPushDab(map, 50, 50, 10, 0, 20, 1.0);

    const centerIdx = 50 * 100 + 50;
    // Center pixel should have significant dx (brushWeight at dist=0 is 1)
    expect(map.dx[centerIdx]).toBeGreaterThan(8);
    // No vertical displacement
    expect(map.dy[centerIdx]).toBeCloseTo(0);
  });

  it('falls off to zero outside brush radius', () => {
    const map = createDisplacementMap(100, 100);
    applyPushDab(map, 50, 50, 10, 5, 20, 1.0);

    // A pixel well outside the radius (50 + 30 = 80) should be unaffected
    const outsideIdx = 50 * 100 + 80;
    expect(map.dx[outsideIdx]).toBe(0);
    expect(map.dy[outsideIdx]).toBe(0);
  });

  it('scales with pressure', () => {
    const mapHalf = createDisplacementMap(100, 100);
    const mapFull = createDisplacementMap(100, 100);
    applyPushDab(mapHalf, 50, 50, 10, 0, 20, 0.5);
    applyPushDab(mapFull, 50, 50, 10, 0, 20, 1.0);

    const centerIdx = 50 * 100 + 50;
    expect(mapHalf.dx[centerIdx]).toBeCloseTo(mapFull.dx[centerIdx]! / 2, 5);
  });

  it('accumulates across multiple dabs', () => {
    const map = createDisplacementMap(100, 100);
    applyPushDab(map, 50, 50, 5, 0, 20, 1.0);
    const afterFirst = map.dx[50 * 100 + 50]!;
    applyPushDab(map, 50, 50, 5, 0, 20, 1.0);
    const afterSecond = map.dx[50 * 100 + 50]!;

    expect(afterSecond).toBeCloseTo(afterFirst * 2, 5);
  });

  it('does not affect pixels at exact radius boundary', () => {
    const map = createDisplacementMap(100, 100);
    const radius = 20;
    // Pixel exactly at radius: distSq === radiusSq → brushWeight = 0
    applyPushDab(map, 50, 50, 10, 0, radius, 1.0);

    const boundaryIdx = 50 * 100 + (50 + radius);
    expect(map.dx[boundaryIdx]).toBe(0);
  });
});

describe('applyTwirlDab', () => {
  it('rotates displacement vectors around center (CW)', () => {
    const map = createDisplacementMap(100, 100);
    // Apply a downward displacement at a point above center first
    const aboveCenterIdx = 30 * 100 + 50;
    map.dy[aboveCenterIdx] = 5;

    applyTwirlDab(map, 50, 50, 30, 1.0, true);

    // After CW twirl: a point above center should gain rightward displacement
    // (the effect is additive so dx should become positive)
    expect(map.dx[aboveCenterIdx]).toBeGreaterThan(0);
  });

  it('CW and CCW produce opposite horizontal displacement', () => {
    const mapCw = createDisplacementMap(100, 100);
    const mapCcw = createDisplacementMap(100, 100);

    applyTwirlDab(mapCw, 50, 50, 30, 0.5, true);
    applyTwirlDab(mapCcw, 50, 50, 30, 0.5, false);

    // A point above center: CW adds positive dx, CCW adds negative dx
    const aboveCenterIdx = 30 * 100 + 50;
    expect(mapCw.dx[aboveCenterIdx]).toBeGreaterThan(0);
    expect(mapCcw.dx[aboveCenterIdx]).toBeLessThan(0);
  });

  it('leaves the center pixel unchanged', () => {
    const map = createDisplacementMap(100, 100);
    applyTwirlDab(map, 50, 50, 20, 1.0, true);

    // Center: distX = 0, distY = 0 → dist = 0 → no movement contributes
    const centerIdx = 50 * 100 + 50;
    expect(map.dx[centerIdx]).toBeCloseTo(0, 5);
    expect(map.dy[centerIdx]).toBeCloseTo(0, 5);
  });
});

describe('sampleBilinear', () => {
  it('returns exact pixel value at integer coords', () => {
    // 2x2 image: red, green, blue, white
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,  // (0,0) red
      0, 255, 0, 255,  // (1,0) green
      0, 0, 255, 255,  // (0,1) blue
      255, 255, 255, 255, // (1,1) white
    ]);
    const [r, g, b, a] = sampleBilinear(data, 2, 2, 0, 0);
    expect(r).toBeCloseTo(255);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
    expect(a).toBeCloseTo(255);
  });

  it('interpolates halfway between two pixels', () => {
    // 2x1 image: red at x=0, green at x=1
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const [r, g] = sampleBilinear(data, 2, 1, 0.5, 0);
    expect(r).toBeCloseTo(127.5);
    expect(g).toBeCloseTo(127.5);
  });

  it('clamps to border pixel when sampling out of bounds', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]);
    const [r] = sampleBilinear(data, 2, 1, -1, 0);
    expect(r).toBeCloseTo(255); // clamps to x=0
  });

  it('produces correctly blended RGBA from 2x2 bilinear sample', () => {
    // 2x2 image: fully opaque corners at different values
    const data = new Uint8ClampedArray([
      100, 0, 0, 255,  // (0,0)
      200, 0, 0, 255,  // (1,0)
      100, 0, 0, 255,  // (0,1)
      200, 0, 0, 255,  // (1,1)
    ]);
    // At x=0.5, y=0.5: all four corners contribute equally → average of 100,200,100,200 = 150
    const [r] = sampleBilinear(data, 2, 2, 0.5, 0.5);
    expect(r).toBeCloseTo(150);
  });
});

describe('applyDab dispatch', () => {
  const settings: LiquifySettings = {
    mode: 'push',
    brushSize: 40,
    pressure: 1.0,
  };

  it('push mode changes displacement in drag direction', () => {
    const map = createDisplacementMap(100, 100);
    applyDab(map, 50, 50, 10, 3, settings);
    expect(map.dx[50 * 100 + 50]).toBeGreaterThan(0);
    expect(map.dy[50 * 100 + 50]).toBeGreaterThan(0);
  });

  it('bloat mode creates outward displacement', () => {
    const map = createDisplacementMap(100, 100);
    applyDab(map, 50, 50, 0, 0, { ...settings, mode: 'bloat' });
    // Bloat: output pixel at (50,40) samples from closer to center → dy > 0
    // (source is pulled toward center so result appears pushed outward)
    const aboveIdx = 40 * 100 + 50;
    expect(map.dy[aboveIdx]).toBeGreaterThan(0);
  });

  it('pinch mode creates inward displacement', () => {
    const map = createDisplacementMap(100, 100);
    applyDab(map, 50, 50, 0, 0, { ...settings, mode: 'pinch' });
    // Pinch: output pixel at (50,40) samples from farther from center → dy < 0
    const aboveIdx = 40 * 100 + 50;
    expect(map.dy[aboveIdx]).toBeLessThan(0);
  });

  it('twirl-cw and twirl-ccw produce mirrored effects', () => {
    const mapCw = createDisplacementMap(100, 100);
    const mapCcw = createDisplacementMap(100, 100);
    applyDab(mapCw, 50, 50, 0, 0, { ...settings, mode: 'twirl-cw' });
    applyDab(mapCcw, 50, 50, 0, 0, { ...settings, mode: 'twirl-ccw' });
    const aboveIdx = 35 * 100 + 50;
    expect(mapCw.dx[aboveIdx]).toBeGreaterThan(0);
    expect(mapCcw.dx[aboveIdx]).toBeLessThan(0);
  });
});
