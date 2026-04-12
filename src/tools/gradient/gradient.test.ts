import { describe, it, expect } from 'vitest';
import {
  interpolateGradient,
  computeLinearGradientT,
  computeRadialGradientT,
  defaultGradientSettings,
} from './gradient';

describe('defaultGradientSettings', () => {
  it('returns black to white linear gradient', () => {
    const s = defaultGradientSettings();
    expect(s.type).toBe('linear');
    expect(s.stops.length).toBe(2);
  });
});

describe('interpolateGradient', () => {
  const stops = [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ] as const;

  it('t=0 returns first stop color', () => {
    const result = interpolateGradient(stops, 0);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('t=1 returns last stop color', () => {
    const result = interpolateGradient(stops, 1);
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
    expect(result.b).toBe(255);
  });

  it('t=0.5 returns midpoint', () => {
    const result = interpolateGradient(stops, 0.5);
    expect(result.r).toBe(128);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });

  it('handles empty stops', () => {
    const result = interpolateGradient([], 0.5);
    expect(result.r).toBe(0);
    expect(result.a).toBe(0);
  });

  it('handles single stop', () => {
    const result = interpolateGradient(
      [{ position: 0.5, color: { r: 100, g: 200, b: 50, a: 1 } }],
      0.8,
    );
    expect(result.r).toBe(100);
    expect(result.g).toBe(200);
    expect(result.b).toBe(50);
  });

  it('interpolates 3-stop gradient at first segment midpoint', () => {
    const threeStops = [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ] as const;
    const result = interpolateGradient(threeStops, 0.25);
    expect(result.r).toBe(128);
    expect(result.g).toBe(128);
    expect(result.b).toBe(0);
  });

  it('interpolates 3-stop gradient at second segment midpoint', () => {
    const threeStops = [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ] as const;
    const result = interpolateGradient(threeStops, 0.75);
    expect(result.r).toBe(0);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });

  it('returns exact color at a stop position', () => {
    const threeStops = [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ] as const;
    const result = interpolateGradient(threeStops, 0.5);
    expect(result.r).toBe(0);
    expect(result.g).toBe(255);
    expect(result.b).toBe(0);
  });

  it('clamps t below 0', () => {
    const result = interpolateGradient(stops, -0.5);
    expect(result.r).toBe(0);
  });

  it('clamps t above 1', () => {
    const result = interpolateGradient(stops, 1.5);
    expect(result.r).toBe(255);
  });

  it('interpolates alpha between stops', () => {
    const alphaStops = [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
      { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
    ] as const;
    const result = interpolateGradient(alphaStops, 0.5);
    expect(result.a).toBeCloseTo(0.5);
  });

  it('handles 4-stop gradient with uneven spacing', () => {
    const fourStops = [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 0.2, color: { r: 100, g: 0, b: 0, a: 1 } },
      { position: 0.8, color: { r: 0, g: 100, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 100, a: 1 } },
    ] as const;
    // At t=0.1 (midpoint of first segment 0->0.2)
    const result = interpolateGradient(fourStops, 0.1);
    expect(result.r).toBe(50);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });
});

describe('computeLinearGradientT', () => {
  it('at start = 0', () => {
    expect(computeLinearGradientT(0, 0, 0, 0, 100, 0)).toBe(0);
  });

  it('at end = 1', () => {
    expect(computeLinearGradientT(100, 0, 0, 0, 100, 0)).toBe(1);
  });

  it('at midpoint = 0.5', () => {
    expect(computeLinearGradientT(50, 0, 0, 0, 100, 0)).toBe(0.5);
  });

  it('clamps beyond endpoints', () => {
    expect(computeLinearGradientT(-50, 0, 0, 0, 100, 0)).toBe(0);
    expect(computeLinearGradientT(150, 0, 0, 0, 100, 0)).toBe(1);
  });
});

describe('computeRadialGradientT', () => {
  it('at center = 0', () => {
    expect(computeRadialGradientT(50, 50, 50, 50, 100)).toBe(0);
  });

  it('at edge = 1', () => {
    expect(computeRadialGradientT(150, 50, 50, 50, 100)).toBe(1);
  });

  it('clamps beyond radius', () => {
    expect(computeRadialGradientT(200, 50, 50, 50, 100)).toBe(1);
  });
});
