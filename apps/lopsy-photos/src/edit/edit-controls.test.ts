import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, RECIPE_RANGES, type Recipe } from '@lopsy/photos-core/library/recipe';
import {
  GROUPS,
  applyChanges,
  beforeRecipe,
  changeLabel,
  groupResetChanges,
  isGroupDefault,
  numberAt,
  sliderChanges,
} from './edit-controls';

function group(id: string) {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(id);
  return g;
}

describe('GROUPS', () => {
  it('has a range for every control', () => {
    for (const g of GROUPS) for (const c of g.controls) expect(RECIPE_RANGES[c.path]).toBeDefined();
  });
});

describe('changeLabel', () => {
  it('writes the value as the history shows it', () => {
    expect(changeLabel('Exposure', 'tone.exposure', 0.3)).toBe('Exposure +0.30');
    expect(changeLabel('Contrast', 'tone.contrast', -12)).toBe('Contrast −12');
    expect(changeLabel('Vignette', 'finish.vignette', 0)).toBe('Vignette 0');
  });
});

describe('applyChanges', () => {
  it('sets and clamps values', () => {
    const r = applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 0.5, 'tone.contrast': 400 });
    expect(r.tone.exposure).toBe(0.5);
    expect(r.tone.contrast).toBe(100);
    expect(numberAt(r, 'tone.exposure')).toBe(0.5);
  });
});

describe('sliderChanges', () => {
  it('makes white balance custom', () => {
    expect(sliderChanges('whiteBalance.tint', 4)).toEqual({ 'whiteBalance.tint': 4, 'whiteBalance.mode': 'custom' });
    expect(sliderChanges('tone.shadows', 4)).toEqual({ 'tone.shadows': 4 });
  });
});

describe('group reset', () => {
  it('resets only what changed', () => {
    const r: Recipe = applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 1, 'tone.blacks': -3, 'color.vibrance': 9 });
    expect(groupResetChanges(r, group('tone'))).toEqual({ 'tone.exposure': 0, 'tone.blacks': 0 });
    expect(isGroupDefault(r, group('finish'))).toBe(true);
    expect(isGroupDefault(r, group('color'))).toBe(false);
  });

  it('puts white balance back to as shot', () => {
    const r = applyChanges(DEFAULT_RECIPE, sliderChanges('whiteBalance.temperature', 20));
    expect(groupResetChanges(r, group('whiteBalance'))).toEqual({
      'whiteBalance.temperature': 0,
      'whiteBalance.mode': 'asShot',
    });
  });
});

describe('beforeRecipe', () => {
  it('keeps the framing and drops the rest', () => {
    const r: Recipe = {
      ...applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 2 }),
      framing: { rotate: 90, flipH: true, crop: null },
    };
    const b = beforeRecipe(r);
    expect(b.tone.exposure).toBe(0);
    expect(b.framing).toEqual(r.framing);
  });
});
