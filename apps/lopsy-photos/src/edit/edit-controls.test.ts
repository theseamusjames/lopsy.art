import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, RECIPE_RANGES, type Recipe } from '@lopsy/photos-core/library/recipe';
import {
  GROUPS,
  applyChanges,
  beforeRecipe,
  changeLabel,
  flipRecipe,
  rotateRecipe,
  groupResetChanges,
  isGroupDefault,
  numberAt,
  sliderChanges,
  toneChanges,
  COLOR_BY_HUE_TABS,
  COLOR_GRADING_SHARED,
  COLOR_GRADING_TABS,
  curvesResetChanges,
  resetChangesFor,
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

describe('framing', () => {
  it('rotates both ways and wraps', () => {
    expect(rotateRecipe(DEFAULT_RECIPE, true).framing.rotate).toBe(90);
    expect(rotateRecipe(DEFAULT_RECIPE, false).framing.rotate).toBe(270);
    expect(rotateRecipe(rotateRecipe(DEFAULT_RECIPE, false), true).framing.rotate).toBe(0);
  });

  it('flips and keeps the crop, which is stored on the unflipped image', () => {
    const cropped: Recipe = { ...DEFAULT_RECIPE, framing: { rotate: 0, flipH: false, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } };
    expect(flipRecipe(cropped).framing).toEqual({ rotate: 0, flipH: true, crop: cropped.framing.crop });
  });
});

describe('toneChanges', () => {
  it('lists only the tone values that change', () => {
    const tone = { ...DEFAULT_RECIPE.tone, exposure: 0.85, contrast: 12 };
    expect(toneChanges(DEFAULT_RECIPE, tone)).toEqual({ 'tone.exposure': 0.85, 'tone.contrast': 12 });
    expect(toneChanges(DEFAULT_RECIPE, DEFAULT_RECIPE.tone)).toEqual({});
  });
});

describe('colour controls', () => {
  it('has a range for every tab slider', () => {
    for (const tab of [...COLOR_BY_HUE_TABS, ...COLOR_GRADING_TABS]) {
      expect(tab.controls.length).toBeGreaterThan(0);
      for (const c of tab.controls) expect(RECIPE_RANGES[c.path]).toBeDefined();
    }
    for (const c of COLOR_GRADING_SHARED) expect(RECIPE_RANGES[c.path]).toBeDefined();
    expect(COLOR_BY_HUE_TABS[1]?.controls[1]).toEqual({ path: 'colorByHue.orange.saturation', label: 'Orange', historyLabel: 'Orange saturation' });
  });

  it('resets numeric controls and bent curves', () => {
    const r = applyChanges(DEFAULT_RECIPE, {
      'colorByHue.aqua.hue': 20,
      'colorGrading.blending': 70,
      'curves.red': [{ x: 0, y: 0.1 }, { x: 1, y: 1 }],
    });
    const controls = [...COLOR_BY_HUE_TABS.flatMap((t) => t.controls), ...COLOR_GRADING_SHARED];
    expect(resetChangesFor(r, controls)).toEqual({ 'colorByHue.aqua.hue': 0, 'colorGrading.blending': 50 });
    expect(curvesResetChanges(r)).toEqual({ 'curves.red': [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(curvesResetChanges(DEFAULT_RECIPE)).toEqual({});
  });
});
