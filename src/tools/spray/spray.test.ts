import { describe, it, expect } from 'vitest';
import { generateSprayDots, defaultSpraySettings } from './spray';

describe('generateSprayDots', () => {
  it('returns the requested number of dots', () => {
    const dots = generateSprayDots(100, 100, 20, 15, 0.5);
    expect(dots).toHaveLength(15);
  });

  it('places dots within the brush radius', () => {
    const cx = 50;
    const cy = 50;
    const radius = 30;
    const dots = generateSprayDots(cx, cy, radius, 200, 0.8);

    for (const dot of dots) {
      const dx = dot.x - cx;
      const dy = dot.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(radius + dot.radius);
    }
  });

  it('generates dots with varying size and opacity', () => {
    const dots = generateSprayDots(100, 100, 40, 50, 0.6);
    const radii = new Set(dots.map((d) => d.radius));
    const opacities = new Set(dots.map((d) => Math.round(d.opacity * 100)));
    expect(radii.size).toBeGreaterThan(1);
    expect(opacities.size).toBeGreaterThan(1);
  });

  it('caps opacity at 1', () => {
    const dots = generateSprayDots(0, 0, 10, 100, 1);
    for (const dot of dots) {
      expect(dot.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('ensures minimum dot radius of 1', () => {
    const dots = generateSprayDots(0, 0, 5, 50, 0.5);
    for (const dot of dots) {
      expect(dot.radius).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('defaultSpraySettings', () => {
  it('returns sensible defaults', () => {
    const settings = defaultSpraySettings();
    expect(settings.size).toBeGreaterThan(0);
    expect(settings.density).toBeGreaterThan(0);
    expect(settings.opacity).toBeGreaterThan(0);
    expect(settings.hardness).toBeGreaterThanOrEqual(0);
  });
});
