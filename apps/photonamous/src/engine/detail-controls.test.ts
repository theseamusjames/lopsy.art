import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { detailKey, detailValues, localContrastValues } from './detail-controls';

describe('detailValues', () => {
  it('is off by default and packs seven floats', () => {
    expect(detailValues(DEFAULT_RECIPE, 1)).toBeNull();
    const r: Recipe = { ...DEFAULT_RECIPE, sharpness: { amount: 60, radius: 1.2, edges: 30 }, noise: { luminance: 10, color: 25, detail: 50 } };
    expect(Array.from(detailValues(r, 0.5) ?? []).map((v) => Math.round(v * 100) / 100)).toEqual([60, 1.2, 30, 10, 25, 50, 0.5]);
  });

  it('runs for noise reduction alone', () => {
    const r: Recipe = { ...DEFAULT_RECIPE, sharpness: { ...DEFAULT_RECIPE.sharpness, amount: 0 }, noise: { ...DEFAULT_RECIPE.noise, color: 20 } };
    expect(detailValues(r, 1)).not.toBeNull();
  });
});

describe('localContrastValues', () => {
  it('is off by default and packs four floats', () => {
    expect(localContrastValues(DEFAULT_RECIPE, 1)).toBeNull();
    const r: Recipe = { ...DEFAULT_RECIPE, localContrast: { large: 20, small: -10, haze: 35 } };
    expect(Array.from(localContrastValues(r, 1) ?? [])).toEqual([20, -10, 35, 1]);
    expect(detailKey(r, 1)).not.toBe(detailKey(DEFAULT_RECIPE, 1));
  });
});
