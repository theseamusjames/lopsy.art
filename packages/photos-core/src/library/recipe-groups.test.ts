import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COPY_GROUPS,
  DEFAULT_RECIPE,
  groupOfPath,
  isDefaultRecipe,
  isGroupDefault,
  pickGroups,
  RECIPE_GROUPS,
  RECIPE_RANGES,
  recipeFromPaths,
  recipeHash,
  recipeToPaths,
  sanitizeRecipeValues,
} from './recipe';

describe('the rest of the recipe', () => {
  it('defaults to no local contrast, no sharpening and no noise reduction', () => {
    expect(DEFAULT_RECIPE.localContrast).toEqual({ large: 0, small: 0, haze: 0 });
    expect(DEFAULT_RECIPE.sharpness).toEqual({ amount: 0, radius: 1, edges: 0 });
    expect(DEFAULT_RECIPE.noise).toEqual({ luminance: 0, color: 0, detail: 50 });
    expect(DEFAULT_RECIPE.framing).toMatchObject({ angle: 0, flipV: false });
    expect(recipeHash(DEFAULT_RECIPE)).toBe('7f20cac1cb53c8fd');
  });

  it('clamps and round-trips', () => {
    const recipe = recipeFromPaths({
      'framing.angle': 60,
      'framing.flipV': true,
      'localContrast.haze': -150,
      'sharpness.amount': 200,
      'sharpness.radius': 0.1,
      'noise.detail': 'lots',
    });
    expect(recipe.framing.angle).toBe(45);
    expect(recipe.framing.flipV).toBe(true);
    expect(recipe.localContrast.haze).toBe(-100);
    expect(recipe.sharpness).toEqual({ amount: 150, radius: 0.5, edges: 0 });
    expect(recipe.noise.detail).toBe(50);
    expect(recipeFromPaths(JSON.parse(JSON.stringify(recipeToPaths(recipe))))).toEqual(recipe);
    expect(RECIPE_RANGES['sharpness.radius']).toEqual({ min: 0.5, max: 3, step: 0.1 });
    expect(isDefaultRecipe(recipe)).toBe(false);
    expect(recipeHash(recipeFromPaths({ 'noise.detail': 51 }))).not.toBe(recipeHash(DEFAULT_RECIPE));
  });
});

describe('recipe groups', () => {
  it('cover every path but pipeline, each in one group', () => {
    for (const path of Object.keys(recipeToPaths(DEFAULT_RECIPE))) {
      if (path === 'pipeline') expect(groupOfPath(path)).toBeNull();
      else expect(groupOfPath(path), path).not.toBeNull();
    }
    expect(groupOfPath('colorByHue.red.hue')).toBe('color');
    expect(groupOfPath('colorGrading.blending')).toBe('colorGrading');
    expect(groupOfPath('noise.color')).toBe('detail');
    expect(RECIPE_GROUPS.map((g) => g.id)).toHaveLength(11);
    expect(DEFAULT_COPY_GROUPS).not.toContain('framing');
    expect(DEFAULT_COPY_GROUPS).not.toContain('areas');
    expect(DEFAULT_COPY_GROUPS).toHaveLength(9);
  });

  it('pick values by group and tell defaults', () => {
    const recipe = recipeFromPaths({ 'tone.exposure': 1, 'framing.crop': { x: 0, y: 0, width: 0.5, height: 0.5 } });
    const tone = pickGroups(recipe, ['tone']);
    expect(Object.keys(tone).every((p) => p.startsWith('tone.'))).toBe(true);
    expect(tone['tone.exposure']).toBe(1);
    expect(pickGroups(recipe, ['framing'])['framing.crop']).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(isGroupDefault(recipe, 'tone')).toBe(false);
    expect(isGroupDefault(recipe, 'color')).toBe(true);
    expect(isGroupDefault(recipe, 'framing')).toBe(false);
  });

  it('sanitize values: unknown paths dropped, numbers clamped, invalid ones defaulted', () => {
    expect(
      sanitizeRecipeValues({ 'tone.exposure': 9, 'tone.contrast': 'x', 'not.a.path': 1, 'curves.red': [{ x: 0 }] }),
    ).toEqual({
      'tone.exposure': 5,
      'tone.contrast': 0,
      'curves.red': [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    expect(sanitizeRecipeValues({ nope: 1 })).toEqual({});
  });
});

describe('finish', () => {
  it('adds the vignette shape and grain without changing hashes, in the finish group', () => {
    expect(recipeHash(recipeFromPaths({}))).toBe(recipeHash(DEFAULT_RECIPE));
    const shaped = recipeFromPaths({ 'finish.vignetteRoundness': 150, 'finish.grain.amount': 40, 'finish.grain.size': -3 });
    expect(shaped.finish).toMatchObject({ vignetteRoundness: 100, grain: { amount: 40, size: 0, roughness: 50 } });
    expect(recipeHash(shaped)).not.toBe(recipeHash(DEFAULT_RECIPE));
    for (const path of [
      'finish.vignetteSize',
      'finish.vignetteRoundness',
      'finish.vignetteFeather',
      'finish.grain.amount',
      'finish.grain.size',
      'finish.grain.roughness',
    ]) {
      expect(groupOfPath(path)).toBe('finish');
      expect(RECIPE_RANGES[path]).toBeDefined();
    }
    // The defaults reproduce the old vignette's falloff: midpoint 0.85, width 0.7 (engine/core/src/finish.rs).
    expect(0.25 + (0.95 * DEFAULT_RECIPE.finish.vignetteSize) / 100).toBeCloseTo(0.85, 10);
    expect(0.05 + (0.95 * DEFAULT_RECIPE.finish.vignetteFeather) / 100).toBeCloseTo(0.7, 10);
  });
});
