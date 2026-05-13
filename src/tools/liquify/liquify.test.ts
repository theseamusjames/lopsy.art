import { describe, it, expect } from 'vitest';
import {
  createDisplacementMap,
  applyPushDab,
  applyTwirlDab,
  encodeDisplacementMap,
  encodeDisplacementRegion,
  MAX_DISP,
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
    expect(map.dx[centerIdx]).toBeLessThan(-8);
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

describe('encodeDisplacementMap', () => {
  it('encodes zero displacement as midpoint (0x8000)', () => {
    const map = createDisplacementMap(2, 2);
    const out = new Uint8Array(2 * 2 * 4);
    encodeDisplacementMap(map, out);
    expect(out[0]).toBe(0x80);
    expect(out[1]).toBe(0x00);
    expect(out[2]).toBe(0x80);
    expect(out[3]).toBe(0x00);
  });

  it('encodes positive displacement above midpoint', () => {
    const map = createDisplacementMap(1, 1);
    map.dx[0] = MAX_DISP;
    const out = new Uint8Array(4);
    encodeDisplacementMap(map, out);
    expect(out[0]).toBe(0xFF);
    expect(out[1]).toBe(0xFF);
  });

  it('encodes negative displacement below midpoint', () => {
    const map = createDisplacementMap(1, 1);
    map.dx[0] = -MAX_DISP;
    const out = new Uint8Array(4);
    encodeDisplacementMap(map, out);
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x00);
  });

  it('round-trips small displacement with sub-pixel precision', () => {
    const map = createDisplacementMap(1, 1);
    map.dx[0] = 3.5;
    map.dy[0] = -7.25;
    const out = new Uint8Array(4);
    encodeDisplacementMap(map, out);
    const ndx = ((out[0]! * 256 + out[1]!) / 65535);
    const ndy = ((out[2]! * 256 + out[3]!) / 65535);
    const decodedDx = (ndx * 2.0 - 1.0) * MAX_DISP;
    const decodedDy = (ndy * 2.0 - 1.0) * MAX_DISP;
    expect(decodedDx).toBeCloseTo(3.5, 0);
    expect(decodedDy).toBeCloseTo(-7.25, 0);
  });
});

describe('encodeDisplacementRegion', () => {
  it('encodes only the specified sub-rect and returns contiguous data', () => {
    const map = createDisplacementMap(10, 10);
    map.dx[3 * 10 + 2] = 100;
    const encoded = new Uint8Array(10 * 10 * 4);
    encodeDisplacementMap(map, encoded);

    map.dx[3 * 10 + 2] = 200;
    const sub = encodeDisplacementRegion(map, encoded, { x: 1, y: 2, w: 3, h: 3 });

    expect(sub.length).toBe(3 * 3 * 4);
    const fullIdx = (3 * 10 + 2) * 4;
    const subIdx = (1 * 3 + 1) * 4;
    expect(sub[subIdx]).toBe(encoded[fullIdx]);
    expect(sub[subIdx + 1]).toBe(encoded[fullIdx + 1]);
  });
});

describe('applyDab dispatch', () => {
  const settings: LiquifySettings = {
    mode: 'push',
    brushSize: 40,
    pressure: 1.0,
  };

  it('push mode changes displacement in drag direction and returns dirty rect', () => {
    const map = createDisplacementMap(100, 100);
    const dirty = applyDab(map, 50, 50, 10, 3, settings);
    expect(map.dx[50 * 100 + 50]).toBeLessThan(0);
    expect(map.dy[50 * 100 + 50]).toBeLessThan(0);
    expect(dirty.x).toBeLessThanOrEqual(50);
    expect(dirty.y).toBeLessThanOrEqual(50);
    expect(dirty.x + dirty.w).toBeGreaterThanOrEqual(50);
    expect(dirty.y + dirty.h).toBeGreaterThanOrEqual(50);
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
