import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, type Recipe } from '@lopsy/photos-core/library/recipe';
import { colorControlsKey, colorGradeValues, colorMixerValues, curvesLut } from './color-controls';

const lifted: Recipe = {
  ...DEFAULT_RECIPE,
  curves: { ...DEFAULT_RECIPE.curves, luminance: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] },
};

describe('curvesLut', () => {
  it('is null for straight curves and packs Luminance into alpha', () => {
    expect(curvesLut(DEFAULT_RECIPE)).toBeNull();
    const lut = curvesLut(lifted);
    expect(lut).toHaveLength(1024);
    expect(lut?.[3]).toBe(51);
    expect(lut?.[0]).toBe(0);
  });
});

describe('colorMixerValues', () => {
  it('sends 24 floats in band order', () => {
    expect(colorMixerValues(DEFAULT_RECIPE)).toBeNull();
    const r: Recipe = {
      ...DEFAULT_RECIPE,
      colorByHue: { ...DEFAULT_RECIPE.colorByHue, aqua: { hue: 10, saturation: -20, luminance: 30 } },
    };
    const v = colorMixerValues(r);
    expect(v).toHaveLength(24);
    expect(Array.from(v?.slice(12, 15) ?? [])).toEqual([10, -20, 30]);
  });
});

describe('colorGradeValues', () => {
  it('is null for neutral wheels and 18 floats otherwise', () => {
    expect(colorGradeValues(DEFAULT_RECIPE)).toBeNull();
    const r: Recipe = {
      ...DEFAULT_RECIPE,
      colorGrading: { ...DEFAULT_RECIPE.colorGrading, highlights: { hue: 40, saturation: 30, luminance: 0 } },
    };
    expect(colorGradeValues(r)).toHaveLength(18);
  });
});

describe('colorControlsKey', () => {
  it('changes with any of the three controls', () => {
    const base = colorControlsKey(DEFAULT_RECIPE);
    expect(colorControlsKey(lifted)).not.toBe(base);
    expect(colorControlsKey({ ...DEFAULT_RECIPE, colorGrading: { ...DEFAULT_RECIPE.colorGrading, balance: 5 } })).not.toBe(base);
  });
});
