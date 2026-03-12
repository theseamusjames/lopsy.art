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
