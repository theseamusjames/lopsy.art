import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, recipeFromPaths, type Recipe } from '@lopsy/photos-core/library/recipe';
import { limitForLegacy, whiteBalanceFilter } from './recipe-to-adjustments';
import {
  AREA_LOOK_LEN,
  CURVES_LEN,
  LOOK_LEN,
  TONE_LEN,
  curvesKey,
  developAreaLookValues,
  developCurvesValues,
  developLookValues,
  developPathFor,
  developStages,
  developToneValues,
} from './develop-stages';
import { compileColorGrade } from './color-grading';

const EDITED: Recipe = {
  ...DEFAULT_RECIPE,
  tone: { exposure: 0.5, contrast: 10, highlights: -20, shadows: 30, whites: 40, blacks: -50 },
  whiteBalance: { ...DEFAULT_RECIPE.whiteBalance, temperature: 25, tint: -15 },
  color: { vibrance: 12, saturation: -34 },
};

describe('developPathFor', () => {
  it('runs the linear stages with float targets and the legacy ones without', () => {
    expect(developPathFor(true)).toBe('linear');
    expect(developPathFor(false)).toBe('legacy');
  });
});

describe('developToneValues', () => {
  it('is 8 zeros for the default recipe, RAW or not', () => {
    expect(Array.from(developToneValues(DEFAULT_RECIPE, false))).toEqual(new Array(TONE_LEN).fill(0));
    expect(Array.from(developToneValues(DEFAULT_RECIPE, true))).toEqual(new Array(TONE_LEN).fill(0));
  });

  it('carries exposure, temperature and tint for a photo that is not RAW', () => {
    const v = Array.from(developToneValues(EDITED, false));
    expect(v[0]).toBeCloseTo(0.5, 6);
    expect(v.slice(1)).toEqual([25, -15, 10, -20, 30, 40, -50]);
  });

  it('leaves exposure, temperature and tint to the RAW step for a RAW photo', () => {
    expect(Array.from(developToneValues(EDITED, true))).toEqual([0, 0, 0, 10, -20, 30, 40, -50]);
  });
});

describe('developLookValues', () => {
  it('is 44 zeros for the default recipe', () => {
    const v = developLookValues(DEFAULT_RECIPE, false);
    expect(v.length).toBe(LOOK_LEN);
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  it('puts vibrance and saturation first', () => {
    const v = developLookValues(EDITED, true);
    expect(v[0]).toBe(12);
    expect(v[1]).toBe(-34);
  });

  it('is saturation −100 for Monochrome on a photo that is not RAW only', () => {
    const mono: Recipe = { ...EDITED, profile: { ...DEFAULT_RECIPE.profile, id: 'monochrome' } };
    expect(developLookValues(mono, false)[1]).toBe(-100);
    expect(developLookValues(mono, true)[1]).toBe(-34);
  });

  it('lays out Color by hue as (hue, saturation, luminance) per band at 2..25', () => {
    const recipe: Recipe = {
      ...DEFAULT_RECIPE,
      colorByHue: { ...DEFAULT_RECIPE.colorByHue, red: { hue: 1, saturation: 2, luminance: 3 }, magenta: { hue: 4, saturation: 5, luminance: 6 } },
    };
    const v = Array.from(developLookValues(recipe, false));
    expect(v.slice(2, 5)).toEqual([1, 2, 3]);
    expect(v.slice(23, 26)).toEqual([4, 5, 6]);
    expect(v.slice(26).every((x) => x === 0)).toBe(true);
  });

  it('puts the compiled grade at 26..43', () => {
    const colorGrading = { ...DEFAULT_RECIPE.colorGrading, shadows: { hue: 200, saturation: 40, luminance: -10 } };
    const recipe: Recipe = { ...DEFAULT_RECIPE, colorGrading };
    const v = developLookValues(recipe, false);
    expect(Array.from(v.slice(26))).toEqual(Array.from(compileColorGrade(colorGrading)));
  });
});

describe('developCurvesValues', () => {
  it('is null when every curve is the identity', () => {
    expect(developCurvesValues(DEFAULT_RECIPE)).toBeNull();
  });

  it('is four 4096-entry tables, master first, identities exact', () => {
    const recipe: Recipe = {
      ...DEFAULT_RECIPE,
      curves: { ...DEFAULT_RECIPE.curves, red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] },
    };
    const v = developCurvesValues(recipe);
    expect(v?.length).toBe(CURVES_LEN);
    if (!v) return;
    // Master (0..4095) is the identity, entry i exactly i / 4095 as a float.
    for (const i of [0, 1, 2047, 4095]) expect(v[i]).toBe(Math.fround(i / 4095));
    // Red (4096..8191) lifts its midpoint.
    expect(v[4096 + 2048]).toBeCloseTo(0.7, 2);
    expect(v[4096]).toBe(0);
    expect(v[8191]).toBe(1);
    // Green and blue are the identity.
    expect(v[8192 + 1000]).toBe(Math.fround(1000 / 4095));
    expect(v[12288 + 4095]).toBe(1);
  });

  it('keys by the points, changing when a point moves', () => {
    const moved: Recipe = { ...DEFAULT_RECIPE, curves: { ...DEFAULT_RECIPE.curves, luminance: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] } };
    expect(curvesKey(moved)).not.toBe(curvesKey(DEFAULT_RECIPE));
    expect(curvesKey({ ...DEFAULT_RECIPE })).toBe(curvesKey(DEFAULT_RECIPE));
  });
});

describe('developAreaLookValues', () => {
  it('is null when the area changes no tone or colour', () => {
    expect(developAreaLookValues(DEFAULT_RECIPE)).toBeNull();
  });

  it('is [whites, blacks, vibrance, Color by hue × 24, grade × 18]', () => {
    const fx: Recipe = {
      ...DEFAULT_RECIPE,
      tone: { ...DEFAULT_RECIPE.tone, whites: 20, blacks: -10 },
      color: { ...DEFAULT_RECIPE.color, vibrance: 30 },
      colorByHue: { ...DEFAULT_RECIPE.colorByHue, orange: { hue: 7, saturation: 8, luminance: 9 } },
    };
    const v = developAreaLookValues(fx);
    expect(v?.length).toBe(AREA_LOOK_LEN);
    if (!v) return;
    expect(Array.from(v.slice(0, 3))).toEqual([20, -10, 30]);
    expect(Array.from(v.slice(3, 9))).toEqual([0, 0, 0, 7, 8, 9]);
    expect(Array.from(v.slice(27)).every((x) => x === 0)).toBe(true);
  });
});

describe('developStages', () => {
  it('sends the linear stages with the working space', () => {
    const stages = developStages(EDITED, { isRaw: false, path: 'linear' });
    expect(stages.path).toBe('linear');
    if (stages.path !== 'linear') return;
    expect(Array.from(stages.tone)).toEqual(Array.from(developToneValues(EDITED, false)));
    expect(stages.curves()).toBeNull();
  });

  it('still sends Lopsy’s image adjustments and colour passes without it', () => {
    const stages = developStages(EDITED, { isRaw: false, path: 'legacy' });
    expect(stages.path).toBe('legacy');
    if (stages.path !== 'legacy') return;
    expect(stages.adjustments.contrast).toBe(10);
    expect(stages.adjustments.exposure).toBeCloseTo(0.5, 6);
    expect(stages.adjustments.photoFilter.density).toBe(1);
    expect(stages.curvesLut()).toBeNull();
    expect(stages.mixer()).toBeNull();
  });

  it('sends values past 100 whole on the linear path and holds them at 100 on the legacy one', () => {
    const wide: Recipe = recipeFromPaths({
      'tone.contrast': 150,
      'tone.highlights': -150,
      'tone.shadows': 120,
      'tone.whites': -130,
      'tone.blacks': 150,
      'whiteBalance.mode': 'custom',
      'whiteBalance.temperature': -150,
      'whiteBalance.tint': 140,
      'color.vibrance': 150,
      'color.saturation': 125,
      'colorByHue.red.hue': -150,
      'colorByHue.red.saturation': 150,
      'colorByHue.blue.luminance': 150,
      'colorGrading.shadows.saturation': 60,
      'colorGrading.shadows.luminance': -150,
      'colorGrading.balance': 150,
      'localContrast.large': 150,
      'finish.grain.amount': 150,
    });
    const linear = developStages(wide, { isRaw: false, path: 'linear' });
    if (linear.path !== 'linear') throw new Error('linear');
    expect(Array.from(linear.tone)).toEqual([0, -150, 140, 150, -150, 120, -130, 150]);
    expect(Array.from(linear.look.slice(0, 5))).toEqual([150, 125, -150, 150, 0]);

    const legacy = developStages(wide, { isRaw: false, path: 'legacy' });
    if (legacy.path !== 'legacy') throw new Error('legacy');
    const a = legacy.adjustments;
    expect([a.contrast, a.highlights, a.shadows, a.whites, a.blacks, a.vibrance, a.saturation]).toEqual([100, -100, 100, -100, 100, 100, 100]);
    expect(legacy.adjustments.photoFilter).toEqual(whiteBalanceFilter(-100, 100));
    expect(Array.from(legacy.mixer() ?? []).slice(0, 3)).toEqual([-100, 100, 0]);
    expect(Array.from(legacy.mixer() ?? []).slice(15, 18)).toEqual([0, 0, 100]);
    const grade = recipeFromPaths({ 'colorGrading.shadows.saturation': 60, 'colorGrading.shadows.luminance': -100, 'colorGrading.balance': 100 }).colorGrading;
    expect(Array.from(legacy.grade() ?? [])).toEqual(Array.from(compileColorGrade(grade)));
    // Within ±100 the legacy path sends what it always did.
    expect(limitForLegacy(EDITED)).toEqual(EDITED);
  });
});
