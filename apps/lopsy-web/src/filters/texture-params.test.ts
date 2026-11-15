import { describe, it, expect } from 'vitest';
import { TEXTURE_PARAMS, textureArgs, TEXTURE_KINDS, TEXTURE_BLENDS } from './texture-params';

function defaults(): Record<string, number> {
  return Object.fromEntries(TEXTURE_PARAMS.map((p) => [p.key, p.defaultValue]));
}

describe('textureArgs', () => {
  it('maps the dialog defaults to fine mono grain', () => {
    const a = textureArgs(defaults());
    expect(TEXTURE_KINDS[a.kind]).toBe('Grain');
    expect(TEXTURE_BLENDS[a.blend]).toBe('Light & Dark');
    expect(a.amount).toBeCloseTo(0.3);
    expect(a.size).toBe(3);
    expect(a.stretch).toBe(1);
    expect(a.angleDegrees).toBe(0);
    expect(a.detail).toBeCloseTo(0.4);
    expect(a.contrast).toBe(0);
    expect(a.isColored).toBe(false);
    expect(a.seed).toBe(0);
  });

  it('converts percentage sliders to 0-1 fractions', () => {
    const a = textureArgs({ ...defaults(), amount: 75, detail: 100, contrast: 20 });
    expect(a.amount).toBeCloseTo(0.75);
    expect(a.detail).toBe(1);
    expect(a.contrast).toBeCloseTo(0.2);
  });

  it('clamps out-of-range and non-finite values', () => {
    const a = textureArgs({ amount: 500, size: 0, stretch: -4, detail: Number.NaN, seed: 5000, angle: 720 });
    expect(a.amount).toBe(1);
    expect(a.size).toBe(1);
    expect(a.stretch).toBe(1);
    expect(a.detail).toBe(0);
    expect(a.seed).toBe(999);
    expect(a.angleDegrees).toBe(360);
  });

  it('falls back to the first option for unknown option indices', () => {
    const a = textureArgs({ ...defaults(), kind: 9, blend: -1 });
    expect(a.kind).toBe(0);
    expect(a.blend).toBe(0);
  });

  it('selects each option by index and rounds the seed', () => {
    const a = textureArgs({ ...defaults(), kind: 4, blend: 3, color: 1, seed: 41.6 });
    expect(TEXTURE_KINDS[a.kind]).toBe('Cells');
    expect(TEXTURE_BLENDS[a.blend]).toBe('Relief');
    expect(a.isColored).toBe(true);
    expect(a.seed).toBe(42);
  });
});

describe('TEXTURE_PARAMS', () => {
  it('has a unique key and label per parameter', () => {
    const keys = TEXTURE_PARAMS.map((p) => p.key);
    const labels = TEXTURE_PARAMS.map((p) => p.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every toggle button a label unique across the dialog', () => {
    const buttons = TEXTURE_PARAMS.flatMap((p) => p.options?.map((o) => o.label) ?? []);
    expect(new Set(buttons).size).toBe(buttons.length);
  });

  it('keeps every default inside its slider range', () => {
    for (const p of TEXTURE_PARAMS) {
      expect(p.defaultValue).toBeGreaterThanOrEqual(p.min);
      expect(p.defaultValue).toBeLessThanOrEqual(p.max);
    }
  });
});
